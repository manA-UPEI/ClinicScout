import { getClinic } from "../agentState.ts";
import { asIdList, buildClinicDetail, fail } from "./shared.ts";
import type { AgentTool } from "./shared.ts";

/** Detail lookups per call. */
const MAX_DETAILS_PER_CALL = 8;

export const detailsTool: AgentTool = {
  declaration: {
    name: "get_clinic_details",
    description:
      "Read the full verified record for specific clinics, including the exact " +
      "quotes backing each confirmed fact. Use this before finalizing to check " +
      "your reasoning against what was actually confirmed. A field returned as " +
      "null is Unknown — it is not false.",
    parameters: {
      type: "OBJECT",
      properties: {
        clinic_ids: {
          type: "ARRAY",
          description: `Clinic ids to look up (max ${MAX_DETAILS_PER_CALL}).`,
          items: { type: "STRING" },
        },
      },
      required: ["clinic_ids"],
    },
  },
  async execute(state, args) {
    const ids = asIdList(args.clinic_ids, MAX_DETAILS_PER_CALL);
    if (ids.length === 0) return fail("clinic_ids must be a non-empty array of ids.");

    const details = ids.map((id) => {
      const c = getClinic(state, id);
      if (!c) return { id, error: "unknown id" };
      return buildClinicDetail(id, c);
    });

    return { response: { details } };
  },
};
