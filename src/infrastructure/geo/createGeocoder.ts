import type { GeocodedLocation } from "../../domain/entities/clinic.ts";
import { fixturesEnabled } from "../config/fixtureMode.ts";
import { fixtureGeocode } from "../fixtures/fixtureGeocoder.ts";
import { geocode as nominatimGeocode } from "./nominatimGeocoder.ts";

/**
 * Picks the fixture geocoder when USE_FIXTURES is set, else Nominatim — the
 * same shape as createCache.ts and createRateLimiter.ts, so "which adapter is
 * live" is answered in one place per port rather than at each call site.
 *
 * Checked per call rather than resolved once at import: it costs nothing, and
 * a module-level decision would bake in whatever the environment looked like
 * at import time, which is a needlessly sharp edge in tests.
 */
export function geocode(location: string): Promise<GeocodedLocation> {
  return fixturesEnabled() ? fixtureGeocode(location) : nominatimGeocode(location);
}
