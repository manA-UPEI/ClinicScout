import type { RateLimiter } from "./rateLimiter.ts";
import { FixedWindowRateLimiter } from "./fixedWindowRateLimiter.ts";
import { RedisRateLimiter } from "./redisRateLimiter.ts";
import { createRedisRestTransport } from "../cache/redisRestClient.ts";
import { readRedisConfig } from "../config/redisConfig.ts";

/**
 * Redis-backed when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
 * set — the same variables createCache.ts and createCallSessionStore.ts
 * check — so the limit is one shared count across every serverless
 * instance instead of one count per instance. Falls back to the in-memory
 * limiter otherwise: local dev needs nothing extra configured.
 */
export function createRateLimiter(
  namespace: string,
  limit: number,
  windowMs: number
): RateLimiter {
  const redis = readRedisConfig();
  if (redis) {
    return new RedisRateLimiter(
      createRedisRestTransport(redis),
      namespace,
      limit,
      Math.ceil(windowMs / 1000)
    );
  }
  return new FixedWindowRateLimiter(limit, windowMs);
}
