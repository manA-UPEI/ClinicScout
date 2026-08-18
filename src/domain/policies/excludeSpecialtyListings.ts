import type { Clinic, ExcludedSpecialty } from "../entities/clinic.ts";

/**
 * Splits clinics into ones eligible for ranking and ones filtered out as
 * specialty care, deduping the excluded list by name. OSM lumps fertility
 * labs, LASIK centres and physiotherapists in with urgent care, and a chain
 * lists each branch as its own node — without dedup, a dense city sets aside
 * the same clinic name several times, which shows up as repeated rows in the
 * excluded panel and as a duplicate React key, since the panel keys on name.
 *
 * `alreadyExcluded` carries forward what a previous, narrower search this run
 * already set aside, so a widened re-search doesn't reset the count or
 * reintroduce a duplicate. Both the agent path (agentState.ts's
 * recordSearch) and the deterministic pipeline apply this same rule — it is
 * a safety rail, not a ranking preference, so it must stay identical between
 * them.
 */
export function partitionBySpecialty(
  clinics: Clinic[],
  alreadyExcluded: ExcludedSpecialty[] = []
): { eligible: Clinic[]; excluded: ExcludedSpecialty[] } {
  const excluded = [...alreadyExcluded];
  const eligible: Clinic[] = [];

  for (const clinic of clinics) {
    if (clinic.relevance === "specialty") {
      if (!excluded.some((e) => e.clinic_name === clinic.clinic_name)) {
        excluded.push({
          clinic_name: clinic.clinic_name,
          specialty: clinic.specialty ?? "Specialist referral",
        });
      }
      continue;
    }
    eligible.push(clinic);
  }

  return { eligible, excluded };
}
