import { search_clinics } from "../../../infrastructure/geo/overpassClinicDirectory.ts";
import { eligibleClinics, project, recordSearch } from "../agentState.ts";
import { fail } from "./shared.ts";
import type { AgentTool } from "./shared.ts";
import { formatSearchStep } from "./stepMessages.ts";

/** Hard ceiling on a self-corrected radius, whatever the model asks for. */
const MAX_RADIUS_KM = 25;
const RADIUS_WIDENING_FACTOR = 3;

/**
 * Clamps a model-requested radius to a ceiling derived from the user's
 * original request. Enforced here rather than trusted from the model: an
 * unbounded radius would turn one tool call into a nationwide Overpass query.
 */
function clampSearchRadius(
  requested: number,
  maxRadiusKm: number
): { radiusKm: number; ceiling: number } {
  const ceiling = Math.min(maxRadiusKm * RADIUS_WIDENING_FACTOR, MAX_RADIUS_KM);
  return { radiusKm: Math.min(requested, ceiling), ceiling };
}

export const searchTool: AgentTool = {
  declaration: {
    name: "search_clinics",
    description:
      "Search OpenStreetMap for clinics within a radius of the resolved location. " +
      "Specialty listings (eye care, fertility, physiotherapy and the like) are " +
      "filtered out automatically and reported as a count. You may call this again " +
      "with a larger radius if the result set is too thin to give a good answer; " +
      "results accumulate across calls and already-inspected clinics keep their findings.",
    parameters: {
      type: "OBJECT",
      properties: {
        radius_km: {
          type: "NUMBER",
          description:
            "Search radius in km. Defaults to the user's requested radius. " +
            "Raise this to widen the search; it is capped server-side.",
        },
      },
      required: [],
    },
  },
  async execute(state, args) {
    if (!state.place) {
      return fail("No location resolved yet. Call geocode_location first.");
    }

    const requested =
      typeof args.radius_km === "number" && args.radius_km > 0
        ? args.radius_km
        : state.input.maxRadiusKm;

    const { radiusKm, ceiling } = clampSearchRadius(requested, state.input.maxRadiusKm);
    const widened = state.searchedRadiusKm !== null && radiusKm > state.searchedRadiusKm;

    const { clinics, stale } = await search_clinics(state.place, radiusKm);
    const before = state.clinics.size;
    recordSearch(state, clinics, radiusKm, stale);
    const eligible = eligibleClinics(state);

    return {
      response: {
        searched_radius_km: radiusKm,
        radius_ceiling_km: ceiling,
        total_found: clinics.length,
        eligible_count: eligible.length,
        newly_added: state.clinics.size - before,
        excluded_specialty_count: state.excluded.length,
        served_from_stale_cache: stale,
        clinics: eligible.map((c) => project(state, c)),
      },
      step: formatSearchStep({
        radiusKm,
        widened,
        stale,
        eligibleCount: eligible.length,
        excludedCount: state.excluded.length,
      }),
    };
  },
};
