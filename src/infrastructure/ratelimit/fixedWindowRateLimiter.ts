import type { RateLimiter, RateLimitResult } from "./rateLimiter.ts";

export type { RateLimitResult } from "./rateLimiter.ts";

/** Default for the `maxKeys` constructor parameter — see the class doc comment below. */
const DEFAULT_MAX_KEYS = 50_000;

interface Entry {
  count: number;
  windowStart: number;
}

/**
 * A small in-memory fixed-window rate limiter — the fallback
 * createRateLimiter (./createRateLimiter.ts) hands back when no Redis is
 * configured. Good for a single long-running process, not for multiple
 * serverless instances sharing a limit — see RedisRateLimiter
 * (./redisRateLimiter.ts) for the one that actually holds across instances.
 *
 * consume() is async only to satisfy the shared RateLimiter interface; the
 * work itself is synchronous, so a call site doesn't change depending on
 * which implementation backs it.
 *
 * Fixed windows undercount slightly at the boundary — a burst split across
 * two windows can total up to 2x the limit. Acceptable for stopping
 * accidental hammering of a route that burns free-tier API quota per
 * request; not meant to be an exact throttle.
 *
 * `now` is injectable, the same clock-dependency idiom
 * domain/policies/openingHours.ts and TtlCache both use.
 *
 * Entries live across two generations, `current` and `previous`, capped at
 * `maxKeys` combined rather than a single ever-growing map. Without a cap, a
 * key drawn from unauthenticated, client-controlled input — the ip and
 * unidentified tiers key on `x-forwarded-for`, which is spoofable by design
 * (see clientIp.ts) — lets a caller grow tracked state forever for free: a
 * fresh header value on every request starts a brand-new bucket at count 1,
 * never tripping a limit of its own, and nothing ever evicts an entry once
 * its window has passed on its own.
 *
 * The obvious fix — delete the single oldest entry once a cap is hit — turns
 * out to be a trap: V8's Map keeps an insertion-order backing array, and
 * repeatedly deleting from the front while inserting at the back leaves
 * tombstones that later iteration has to skip past, so "find the oldest key"
 * degrades from instant to seconds per few hundred thousand calls under
 * sustained churn (measured while building this). Rotating generations
 * instead — new entries go into `current`; once it reaches `maxKeys`,
 * `previous` is replaced by `current` wholesale and a fresh `current` starts
 * — never deletes a single key at a time, so there's no per-key Map.delete
 * to build up tombstones from. The trade is a softer bound (up to ~2x
 * `maxKeys` live at once, since a just-rotated `previous` is still full)
 * rather than an exact one, and a bucket can in principle be dropped whole
 * with the rest of its generation before its window naturally elapses — both
 * acceptable for a limiter that already documents itself as approximate, in
 * exchange for eviction that stays O(1) regardless of how long the process
 * has been fielding distinct keys.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private current = new Map<string, Entry>();
  private previous = new Map<string, Entry>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(
    limit: number,
    windowMs: number,
    now: () => number = Date.now,
    maxKeys: number = DEFAULT_MAX_KEYS
  ) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
  }

  private allow(remaining: number): RateLimitResult {
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: Math.max(0, remaining),
      limit: this.limit,
    };
  }

  private read(key: string): Entry | undefined {
    return this.current.get(key) ?? this.previous.get(key);
  }

  async consume(key: string): Promise<RateLimitResult> {
    const t = this.now();
    const entry = this.read(key);

    if (!entry || t - entry.windowStart >= this.windowMs) {
      if (this.current.size >= this.maxKeys && !this.current.has(key)) {
        this.previous = this.current;
        this.current = new Map();
      }
      this.current.set(key, { count: 1, windowStart: t });
      return this.allow(this.limit - 1);
    }

    if (entry.count >= this.limit) {
      return {
        allowed: false,
        retryAfterMs: entry.windowStart + this.windowMs - t,
        remaining: 0,
        limit: this.limit,
      };
    }

    // Mutated in place, wherever this entry currently lives — no need to
    // move it into `current`, since precise recency ordering isn't the
    // point here, only bounding total memory.
    entry.count += 1;
    return this.allow(this.limit - entry.count);
  }
}
