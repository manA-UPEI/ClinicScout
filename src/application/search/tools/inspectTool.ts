import type { Clinic } from "../../../domain/entities/clinic.ts";
import { inspect_clinic, mergeInspection } from "../inspectClinicUseCase.ts";
import { getClinic, recordInspection } from "../agentState.ts";
import { asIdList, fail } from "./shared.ts";
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
      "expensive tool — inspect the plausible front-runners, not everything.",
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

    const inspections = await Promise.all(
      targets.map((t) => inspect_clinic(t.clinic))
    );

    const results = targets.map(({ id, clinic }, i) => {
      const inspection = inspections[i];
      const enriched = mergeInspection(clinic, inspection);
      recordInspection(state, id, enriched);
      return {
        id,
        name: clinic.clinic_name,
        verified_fields: inspection.evidence.map((e) => e.field),
        open_now: enriched.open_now,
      };
    });

    return {
      response: {
        results,
        skipped,
        note: "Fields absent from verified_fields could not be confirmed and remain Unknown. Absence is not evidence of the negative.",
      },
      step: formatInspectStep(ids, targets.length, results),
    };
  },
};
