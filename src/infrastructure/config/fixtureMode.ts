import { logger } from "../logging/logger.ts";

/**
 * Whether every upstream this app talks to is served from canned fixtures
 * instead of the real service.
 *
 * The point is being able to run and demo the whole app — agent loop
 * included — without spending Gemini's free-tier quota or putting load on
 * Nominatim and Overpass, which are volunteer-run services this app is only
 * a guest of. It covers all five upstreams at once (geocoder, clinic
 * directory, website fetcher, and both Gemini clients) because a half-faked
 * run still burns quota, which defeats the purpose.
 *
 * DELIBERATELY NOT BLOCKED IN PRODUCTION BUILDS. Testing a production build
 * offline is a real need, and a mode that refuses to run under
 * `next build && next start` would not serve it. That makes accidental
 * enablement the risk to manage instead, and for an app that tells people
 * where to seek medical care, serving invented clinics unnoticed is a
 * genuinely bad outcome. So the mode is loud rather than locked: it prints a
 * banner across every page, announces itself in the run's own step log,
 * shows up at GET /api/health, and logs a warning at startup. If you can see
 * the app at all, you can see that it is lying.
 */
export function fixturesEnabled(): boolean {
  const value = process.env.USE_FIXTURES;
  return value === "1" || value === "true";
}

// One warning per server process, at the moment anything first asks. The
// banner and the step log cover anyone looking at the app; this covers
// whoever is looking at the logs instead — including the case where the
// variable was set by accident on a deployment nobody is watching.
if (fixturesEnabled()) {
  logger.warn(
    { upstreams: "fixtures" },
    "USE_FIXTURES is on — every upstream is canned. Clinic results are invented and must not be shown to real users."
  );
}
