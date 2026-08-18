import type { Clinic, Coordinates } from "../../domain/entities/clinic.ts";

export interface ClinicSearchResult {
  clinics: Clinic[];
  /** True when this came from cache after the live directory failed. */
  stale: boolean;
}

/** Finds clinics near a point within a radius. */
export interface ClinicDirectory {
  /** Throws AgentError("network") if both the live lookup and the cache fallback fail. */
  search(location: Coordinates, radiusKm: number): Promise<ClinicSearchResult>;
}
