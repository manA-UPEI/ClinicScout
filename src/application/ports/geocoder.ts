import type { GeocodedLocation } from "../../domain/entities/clinic.ts";

/** Resolves free-text location input into coordinates. */
export interface Geocoder {
  /** Throws AgentError("location_not_found" | "network") — a location this can't resolve is the user's to fix. */
  geocode(location: string): Promise<GeocodedLocation>;
}
