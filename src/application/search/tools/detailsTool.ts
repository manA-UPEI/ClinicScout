import { getClinic } from "../agentState.ts";
import { asIdList, fail } from "./shared.ts";
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
      return {
        id,
        name: c.clinic_name,
        distance_km: c.distance_km,
        open_now: c.open_now,
        opening_hours: c.opening_hours,
        current_capacity: c.current_capacity,
        accepts_walk_ins: c.accepts_walk_ins,
        appointment_required: c.appointment_required,
        relevance: c.relevance,
        confidence: c.confidence,
        // Contact details are reported as presence, not value: whether the user
        // can be routed to a next action is the judgment call, and the literal
        // phone number or address adds nothing to it.
        has_booking_url: Boolean(c.booking_url),
        has_email: Boolean(c.email),
        email_booking_supported: c.email_booking_supported,
        has_phone: Boolean(c.phone),
        has_address: Boolean(c.address),
        page_verified_evidence: c.evidence.map((e) => ({
          field: e.field,
          quote: e.quote,
        })),
      };
    });

    return { response: { details } };
  },
};
