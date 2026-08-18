export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller can retry; 0 when `allowed` is true. */
  retryAfterMs: number;
}

/** Shared shape FixedWindowRateLimiter and RedisRateLimiter both implement, so a call site doesn't change depending on which one backs it. */
export interface RateLimiter {
  /** Records one attempt for `key` and reports whether it's allowed. */
  consume(key: string): Promise<RateLimitResult>;
}
