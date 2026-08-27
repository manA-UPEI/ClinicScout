import type { RateLimiter, RateLimitResult } from "./rateLimiter.ts";
import type { RedisTransport } from "../cache/redisRestClient.ts";

/**
 * Increment, set the expiry only on the first hit of a window, and report
 * both the new count and the time left — in one atomic step.
 *
 * Each line earns its place. INCR creates the key at 1 if it is missing, so
 * concurrent callers cannot race past each other the way a separate
 * GET-then-SET would. EXPIRE is guarded on `count == 1` because setting it
 * every time would keep pushing the window out and the limit would never
 * reset. TTL is read here rather than in a follow-up command so the caller
 * gets a retry time measured at the same instant as the count.
 *
 * This used to be three separate round trips, which left a real gap: a
 * process that died between INCR and EXPIRE would leave a key with no TTL
 * that never reset — a bucket permanently stuck at its limit. The gap was a
 * few milliseconds wide and was an acceptable risk for a per-caller limit,
 * but a server-wide counter is hit by every request on the deployment at
 * once, so both the odds and the blast radius change: one unlucky moment
 * would wedge the whole service until someone deleted the key by hand.
 * Redis runs a script atomically, which closes it.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('TTL', KEYS[1])}
`;

/**
 * A RateLimiter backed by a single Redis counter per key, shared across every
 * serverless instance — the piece FixedWindowRateLimiter cannot offer, since
 * each instance would otherwise keep its own count and the real limit ends up
 * multiplied by however many instances happen to be warm.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly transport: RedisTransport;
  private readonly namespace: string;
  private readonly limit: number;
  private readonly windowSeconds: number;

  // Written out instead of constructor parameter properties: Node's
  // strip-only TypeScript execution (the raw `node --test` runner) can erase
  // type annotations but not this shorthand, since it also declares fields.
  constructor(
    transport: RedisTransport,
    namespace: string,
    limit: number,
    windowSeconds: number
  ) {
    this.transport = transport;
    this.namespace = namespace;
    this.limit = limit;
    this.windowSeconds = windowSeconds;
  }

  async consume(key: string): Promise<RateLimitResult> {
    const fullKey = `ratelimit:${this.namespace}:${key}`;
    const [count, ttl] = parseScriptResult(await this.transport.eval(
      CONSUME_SCRIPT,
      [fullKey],
      [this.windowSeconds]
    ));

    if (count <= this.limit) {
      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: Math.max(0, this.limit - count),
        limit: this.limit,
      };
    }

    // Redis reports -1 for a key with no expiry and -2 for one that is gone;
    // neither is a remaining time. Falling back to the full window overstates
    // the wait slightly, which is the safe direction — the alternative is
    // telling a caller to retry immediately into another rejection.
    const secondsLeft = ttl >= 0 ? ttl : this.windowSeconds;

    return {
      allowed: false,
      retryAfterMs: secondsLeft * 1000,
      remaining: 0,
      limit: this.limit,
    };
  }
}

/**
 * Lua's return values arrive as an array of numbers, but the REST transport
 * types its result as `unknown` and Upstash has been known to render integers
 * as strings. Coercing here keeps that quirk in one place instead of letting
 * a string leak into the arithmetic above and turn a comparison into a
 * silently wrong answer.
 */
function parseScriptResult(result: unknown): [count: number, ttl: number] {
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error("Rate limiter script returned an unexpected shape");
  }
  return [Number(result[0]), Number(result[1])];
}
