import type { Clinic } from "../../../domain/entities/clinic.ts";
import { EMPTY_INSPECTION } from "../../../domain/verification/pageEvidence.ts";
import { rank_clinics } from "../../../domain/policies/rankClinics.ts";
import { inspect_clinics_batch, mergeInspection } from "../inspectClinicUseCase.ts";
import { eligibleClinics, getClinic, recordInspection, shortId } from "../agentState.ts";
import { asIdList, buildClinicDetail, fail } from "./shared.ts";
import type { AgentTool } from "./shared.ts";
import { formatInspectStep } from "./stepMessages.ts";

/** Websites read per call. Bounds both latency and the free-tier Gemini quota. */
const MAX_INSPECTIONS_PER_CALL = 5;

export const inspectTool: AgentTool = {
  declaration: {
    name: "inspect_clinic_websites",
    description:
      "Fetch and read the websites of specific clinics to confirm walk-in policy, " +
      "hours, capacity and contact details. Only facts backed by a verbatim quote " +
      "from the page are kept; everything else stays Unknown. Only clinics with " +
      "has_website true are worth passing. This is the slowest and most quota-" +
      "expensive tool — inspect the plausible front-runners, not everything. The " +
      "response already includes each inspected clinic's full confirmed details " +
      "and the current ranking, so you usually will not need get_clinic_details " +
      "afterward for a clinic you just inspected.",
    parameters: {
      type: "OBJECT",
      properties: {
        clinic_ids: {
          type: "ARRAY",
          description: `Clinic ids to inspect (max ${MAX_INSPECTIONS_PER_CALL} per call).`,
          items: { type: "STRING" },
        },
      },
      required: ["clinic_ids"],
    },
  },
  async execute(state, args) {
    const ids = asIdList(args.clinic_ids, MAX_INSPECTIONS_PER_CALL);
    if (ids.length === 0) {
      return fail("clinic_ids must be a non-empty array of ids from search_clinics.");
    }

    const targets: { id: string; clinic: Clinic }[] = [];
    const skipped: string[] = [];
    for (const id of ids) {
      const clinic = getClinic(state, id);
      if (!clinic) skipped.push(`${id} (unknown id)`);
      else if (!clinic.website) skipped.push(`${id} (no website)`);
      else targets.push({ id, clinic });
    }

    if (targets.length === 0) {
      return fail(
        `Nothing to inspect: ${skipped.join(", ")}. Check has_website before inspecting.`
      );
    }

    const inspectionsByWebsite = await inspect_clinics_batch(
      targets.map((t) => t.clinic)
    );

    const results = targets.map(({ id, clinic }) => {
      const inspection = inspectionsByWebsite.get(clinic.website!) ?? EMPTY_INSPECTION;
      const enriched = mergeInspection(clinic, inspection);
      recordInspection(state, id, enriched);
      return buildClinicDetail(id, enriched);
    });

    // Inspection can change ranking-relevant facts (open_now, walk-ins,
    // capacity), so the ranking that came back from search_clinics is
    // recomputed here rather than left stale.
    const ranked = rank_clinics(eligibleClinics(state), state.input.urgency).map((c) => ({
      id: shortId(c.source_url),
      name: c.clinic_name,
      rank: c.rank,
      rationale: c.rationale,
    }));

    return {
      response: {
        results,
        ranked,
        skipped,
        note: "page_verified_evidence is what could be confirmed from the site; everything else on a result stays whatever was already known (or Unknown). Absence is not evidence of the negative.",
      },
      step: formatInspectStep(ids, targets.length, results),
    };
  },
};
