export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller can retry; 0 when `allowed` is true. */
  retryAfterMs: number;
}

/**
 * A small in-memory fixed-window rate limiter — same pattern and the same
 * caveat as TtlCache (infrastructure/cache/ttlCache.ts): good for a single
 * long-running process, not for multiple serverless instances sharing a
 * limit. Swap for a shared store (e.g. Upstash) before that matters.
 *
 * Fixed windows undercount slightly at the boundary — a burst split across
 * two windows can total up to 2x the limit. Acceptable for stopping
 * accidental hammering of a route that burns free-tier API quota per
 * request; not meant to be an exact throttle.
 *
 * `now` is injectable, the same clock-dependency idiom
 * domain/policies/openingHours.ts and TtlCache both use.
 */
export class FixedWindowRateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Records one attempt for `key` and reports whether it's allowed. */
  consume(key: string): RateLimitResult {
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
