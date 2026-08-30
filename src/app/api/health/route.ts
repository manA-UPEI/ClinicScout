import { createEnvConfigProvider } from "@/infrastructure/config/env";
import { readRedisConfig } from "@/infrastructure/config/redisConfig";
import { fixturesEnabled } from "@/infrastructure/config/fixtureMode";
import {
  isAuthConfigured,
  readConfiguredAuthProviders,
} from "@/infrastructure/config/authProviders";

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
 * `sharedStateBackend` covers both things readRedisConfig() gates — the
 * search/inspection caches and the rate limiter — since they both switch on
 * the same two env vars together. On "memory", neither holds correctly
 * across more than one serverless instance; see ARCHITECTURE.md.
 *
 * `authConfigured` is false whenever AUTH_SECRET is missing or no OAuth
 * provider has both halves of its credentials — the state where the app
 * still serves every anonymous visitor normally but nobody can sign in.
 * That degradation is silent by design in the UI (the sign-in link simply
 * doesn't render), which is exactly why a monitor should be able to see it.
 * `authProviders` names which ones are usable; it reveals nothing the
 * sign-in page doesn't already list.
 *
 * `upstreams` is `"fixtures"` when USE_FIXTURES is on and every clinic,
 * website and model reply is invented. A deployment serving the public should
 * never report anything but `"live"` here — it is the machine-readable half
 * of the banner the app paints across every page in that mode.
 */
export async function GET() {
  const config = createEnvConfigProvider();

  return Response.json({
    status: "ok",
    geminiConfigured: config.isGeminiConfigured(),
    sharedStateBackend: readRedisConfig() ? "redis" : "memory",
    authConfigured: isAuthConfigured(),
    authProviders: readConfiguredAuthProviders(),
    upstreams: fixturesEnabled() ? "fixtures" : "live",
  });
}
