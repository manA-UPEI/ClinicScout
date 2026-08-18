import type { RateLimiter, RateLimitResult } from "./rateLimiter.ts";

export type { RateLimitResult } from "./rateLimiter.ts";

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
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  async consume(key: string): Promise<RateLimitResult> {
    const t = this.now();
    const entry = this.hits.get(key);

    if (!entry || t - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: t });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (entry.count >= this.limit) {
      return { allowed: false, retryAfterMs: entry.windowStart + this.windowMs - t };
    }

    entry.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
}
