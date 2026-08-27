import type { GeocodedLocation } from "../../domain/entities/clinic.ts";
import { AgentError } from "../../domain/entities/errors.ts";
import { FIXTURE_PLACE } from "./fixtureData.ts";

/**
 * Resolves anything to one place. The typed location is ignored rather than
 * parsed — there is no fixture world outside Toronto for it to select.
 *
 * The one exception exists so the failure path stays reachable without
 * network flakiness: a location containing "nowhere" raises the same
 * `location_not_found` AgentError the real geocoder raises, which is what
 * drives the UI's error phase. Testing that branch otherwise means typing
 * gibberish and hoping Nominatim agrees it is gibberish.
 */
export async function fixtureGeocode(location: string): Promise<GeocodedLocation> {
  if (location.toLowerCase().includes("nowhere")) {
    throw new AgentError(
      "location_not_found",
      `Couldn't find "${location}". Try adding a city or postal code.`
    );
  }
  return FIXTURE_PLACE;
}
