import type { RateLimiter, RateLimitResult } from "./rateLimiter.ts";
import type { RedisTransport } from "../cache/redisRestClient.ts";

/**
 * A RateLimiter backed by a single Redis counter per key, shared across
 * every serverless instance — the piece FixedWindowRateLimiter alone can't
 * offer, since each instance would otherwise keep its own count and the
 * real limit ends up higher than intended the moment there's more than one
 * warm instance.
 *
 * Fixed-window via INCR+EXPIRE: INCR is atomic and creates the key at 1 if
 * it didn't exist, so concurrent callers can't race past each other the way
 * a separate GET-then-SET would. EXPIRE is only set on the first increment
 * of a window (count === 1) — setting it every time would keep pushing the
 * window out and the limit would never actually reset.
 *
 * The one gap this doesn't close: if the process died between INCR and
 * EXPIRE, the key would persist with no TTL and never reset. Not fixed here
 * — a Lua script would make the two atomic, but that's more machinery than
 * a rate limiter protecting free-tier API quota needs; the window this gap
 * requires is a few milliseconds wide and self-heals the next time that key
 * is deleted or the app is redeployed.
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
    const count = await this.transport.incr(fullKey);

    if (count === 1) {
      await this.transport.expire(fullKey, this.windowSeconds);
    }

    if (count <= this.limit) {
      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: Math.max(0, this.limit - count),
        limit: this.limit,
      };
    }

    const ttl = await this.transport.ttl(fullKey);
    // A missing/expired TTL here (null) would mean the EXPIRE above never
    // landed — fall back to the full window rather than claiming no wait.
    return {
      allowed: false,
      retryAfterMs: (ttl ?? this.windowSeconds) * 1000,
      remaining: 0,
      limit: this.limit,
    };
  }
}
