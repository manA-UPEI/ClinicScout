import type { CallSessionStore } from "../../application/ports/callSessionStore.ts";
import { inMemoryCallSessionStore } from "./inMemoryCallSessionStore.ts";
import { createRedisCallSessionStore } from "./redisCallSessionStore.ts";
import { createRedisRestTransport } from "../cache/redisRestClient.ts";

/**
 * Redis-backed when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
 * set — the same variables infrastructure/cache/createCache.ts checks — so
 * the one-call-per-clinic rule and a session's live transcript hold across
 * serverless instances instead of just within one warm process. Falls back
 * to the in-memory store otherwise: local dev needs nothing extra configured.
 *
 * A singleton built once at import time, same shape
 * application/call/callSessionService.ts already had when it imported the
 * in-memory module directly. Reads process.env directly rather than through
 * ConfigProvider for the same reason createCache.ts does: this is a
 * module-level singleton, not something constructed per request.
 */
function buildStore(): CallSessionStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return createRedisCallSessionStore(createRedisRestTransport({ url, token }));
  }
  return inMemoryCallSessionStore;
}

export const callSessionStore: CallSessionStore = buildStore();
