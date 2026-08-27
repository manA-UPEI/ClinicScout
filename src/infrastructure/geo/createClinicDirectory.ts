import type { ClinicSearchResult } from "../../application/ports/clinicDirectory.ts";
import type { Coordinates } from "../../domain/entities/clinic.ts";
import { fixturesEnabled } from "../config/fixtureMode.ts";
import { fixtureSearchClinics } from "../fixtures/fixtureClinicDirectory.ts";
import { search_clinics as overpassSearchClinics } from "./overpassClinicDirectory.ts";

/** Fixture clinic set when USE_FIXTURES is set, else the live Overpass adapter. */
export function search_clinics(
  location: Coordinates,
  radiusKm: number
): Promise<ClinicSearchResult> {
  return fixturesEnabled()
    ? fixtureSearchClinics(location, radiusKm)
    : overpassSearchClinics(location, radiusKm);
}
