import { AgentError } from "../../domain/entities/errors.ts";
import type { GeocodedLocation } from "../../domain/entities/clinic.ts";
import type { Geocoder } from "../../application/ports/geocoder.ts";
import { createCache } from "../cache/createCache.ts";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy requires an identifying User-Agent.
export const USER_AGENT = "ClinicScout/0.1 (hackathon project)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: { country_code?: string };
}

// A resolved location doesn't go stale the way clinic listings do, but the
// same 24h figure the search cache uses keeps the privacy note in
// Footer.tsx — "cached for up to 24 hours" — true of every upstream this app
// calls, not just the one it originally described.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = createCache<GeocodedLocation>("geocode", CACHE_TTL_MS);

/** Case/whitespace-insensitive, so "Toronto" and " toronto " share one entry. */
function geocodeCacheKey(location: string): string {
  return location.trim().toLowerCase();
}

async function fetchGeocode(location: string): Promise<GeocodedLocation> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&limit=1&addressdetails=1`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AgentError("network", "Could not reach the geocoding service.");
  }

  if (!response.ok) {
    throw new AgentError("network", "The geocoding service returned an error.");
  }

  const results = (await response.json()) as NominatimResult[];
  if (results.length === 0) {
    throw new AgentError(
      "location_not_found",
      `We couldn't find a place called "${location}".`
    );
  }

  return {
    lat: Number(results[0].lat),
    lon: Number(results[0].lon),
    display_name: results[0].display_name,
    countryCode: results[0].address?.country_code ?? null,
  };
}

/**
 * Cached in front of `fetchGeocode`: a repeat search for the same typed
 * location — the common case when someone widens the radius rather than
 * retyping where they are — resolves from cache instead of hitting Nominatim
 * again, the same win `overpassClinicDirectory.ts` already gets for the
 * clinic search itself.
 */
export async function geocode(location: string): Promise<GeocodedLocation> {
  const key = geocodeCacheKey(location);

  const cached = await cache.get(key);
  if (cached) return cached;

  const place = await fetchGeocode(location);
  await cache.set(key, place);
  return place;
}

/** The Geocoder port implementation, adapting the plain `geocode` function above. */
export function createNominatimGeocoder(): Geocoder {
  return { geocode };
}
