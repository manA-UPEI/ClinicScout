import { createEnvConfigProvider } from "@/infrastructure/config/env";
import { readRedisConfig } from "@/infrastructure/config/redisConfig";

// Never cached — a stale "healthy" reading defeats the point of an uptime
// check, and this route does no expensive work that caching would save.
export const dynamic = "force-dynamic";

/**
 * Reports configuration rather than pinging every upstream: Nominatim and
 * Overpass are public services this app doesn't own and shouldn't be
 * polling on someone else's uptime check, and Gemini's actual reachability
 * is already exercised — and gracefully degraded around — by a real search.
 * What an external monitor actually needs to know is narrower: is the
 * deployment itself up, and which backends is it currently configured to use.
 *
 * `sharedStateBackend` covers all three things readRedisConfig() gates —
 * the search/inspection caches, the call-session store, and the rate
 * limiter — since they all switch on the same two env vars together. On
 * "memory", none of the three hold correctly across more than one
 * serverless instance; see ARCHITECTURE.md.
 */
export async function GET() {
  const config = createEnvConfigProvider();

  return Response.json({
    status: "ok",
    geminiConfigured: config.isGeminiConfigured(),
    sharedStateBackend: readRedisConfig() ? "redis" : "memory",
  });
}
