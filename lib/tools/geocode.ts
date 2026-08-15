import { AgentError } from "../types.ts";
import type { GeocodedLocation } from "../types.ts";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy requires an identifying User-Agent.
export const USER_AGENT = "ClinicScout/0.1 (hackathon project)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export async function geocode(location: string): Promise<GeocodedLocation> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&limit=1`;

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
  };
}
