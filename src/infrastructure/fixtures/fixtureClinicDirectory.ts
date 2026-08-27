import type { ClinicSearchResult } from "../../application/ports/clinicDirectory.ts";
import type { Coordinates } from "../../domain/entities/clinic.ts";
import { CLINIC_SEEDS, seedToClinic } from "./fixtureData.ts";

/**
 * Serves the fixture clinic set, filtered by the requested radius exactly as
 * the real adapter filters Overpass results.
 *
 * Honouring the radius rather than always returning everything is what keeps
 * the agent's self-correction path meaningful: a 1km search finds too little
 * to answer well, so the model widens and searches again — the behaviour that
 * is otherwise only observable against live data.
 *
 * `stale` is always false: the stale-cache branch belongs to the real
 * adapter's Overpass retry logic, and there is no cache in front of this.
 */
export async function fixtureSearchClinics(
  location: Coordinates,
  radiusKm: number
): Promise<ClinicSearchResult> {
  void location;
  const clinics = CLINIC_SEEDS.map((seed) => seedToClinic(seed)).filter(
    (clinic) => clinic.distance_km !== null && clinic.distance_km <= radiusKm
  );

  return { clinics, stale: false };
}
