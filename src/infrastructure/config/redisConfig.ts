export interface RedisConfig {
  url: string;
  token: string;
}

/**
 * Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN directly from
 * process.env rather than through ConfigProvider, for the same reason
 * createCache.ts and createCallSessionStore.ts always did: both are
 * module-level singletons built once at import time. Shared here because a
 * third call site (the health check) made the same two-line check worth
 * naming once instead of copying again.
 */
export function readRedisConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
