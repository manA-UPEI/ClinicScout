import type { Cache } from "./cache.ts";
import { TtlCache } from "./ttlCache.ts";
import { RedisCache } from "./redisCache.ts";
import { createRedisRestTransport } from "./redisRestClient.ts";
import { readRedisConfig } from "../config/redisConfig.ts";

/**
 * Redis-backed when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
 * set, so a cache entry holds across serverless instances and cold starts —
 * not just within one warm process, which is what TtlCache alone can offer.
 * Falls back to the in-memory TtlCache otherwise: the same "degrade, don't
 * require new infrastructure" choice the app already makes without a Gemini
 * key, so local dev and a bare-minimum deploy both keep working with
 * nothing extra to provision.
 *
 * Reads config via readRedisConfig() rather than through ConfigProvider
 * (infrastructure/config/env.ts): both call sites (overpassClinicDirectory's
 * search cache, inspectClinicUseCase's inspection cache) construct their
 * cache as a module-level singleton at import time — the same shape TtlCache
 * already had. Threading a ConfigProvider through would mean restructuring
 * both from a singleton into something built per request, for the sake of
 * two env lookups made once at startup.
 */
export function createCache<T>(namespace: string, ttlMs: number): Cache<T> {
  const redis = readRedisConfig();
  if (redis) {
    return new RedisCache<T>(createRedisRestTransport(redis), namespace, ttlMs);
  }
  return new TtlCache<T>(ttlMs);
}
