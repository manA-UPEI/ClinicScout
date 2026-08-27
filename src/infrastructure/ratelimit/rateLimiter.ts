export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller can retry; 0 when `allowed` is true. */
  retryAfterMs: number;
  /** Attempts left in the current window after this one, floored at 0. Surfaced as the `RateLimit-Remaining` header so a caller can see a limit approaching instead of only discovering it at the 429. */
  remaining: number;
  /** The limit this result was measured against, for the matching `RateLimit-Limit` header. */
  limit: number;
}

/** Shared shape FixedWindowRateLimiter and RedisRateLimiter both implement, so a call site doesn't change depending on which one backs it. */
export interface RateLimiter {
  /** Records one attempt for `key` and reports whether it's allowed. */
  consume(key: string): Promise<RateLimitResult>;
}
