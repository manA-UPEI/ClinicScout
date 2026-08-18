import { rank_clinics } from "../../../domain/policies/rankClinics.ts";
import { eligibleClinics, getClinic, shortId } from "../agentState.ts";
import { validateFinalization } from "../citationGuard.ts";
import type { AgentTool } from "./shared.ts";

export const finalizeTool: AgentTool = {
  declaration: {
    name: "finalize_recommendation",
    description:
      "Commit to a recommendation and end the run. Every field you name in " +
      "cited_fields must already be confirmed for that clinic — citing an " +
      "Unknown field will be rejected and you will have to try again.",
    parameters: {
      type: "OBJECT",
      properties: {
        clinic_id: {
          type: "STRING",
          description: "Id of the recommended clinic, exactly as returned by a tool.",
        },
        reason: {
          type: "STRING",
          description:
            "One or two sentences for the user explaining why this clinic, in " +
            "plain language. If you are overriding the deterministic ranking, say so.",
        },
        cited_fields: {
          type: "ARRAY",
          description: "The clinic facts your reason relies on.",
          items: { type: "STRING" },
        },
      },
      required: ["clinic_id", "reason", "cited_fields"],
    },
  },
  async execute(state, args) {
    const eligible = eligibleClinics(state);
    const topRanked = eligible.length
      ? shortId(rank_clinics(eligible, state.input.urgency)[0].source_url)
      : null;

    const result = validateFinalization(state, args, topRanked);
    if (!result.ok) {
      // Not a crash: handed back so the model can fix the citation and retry.
      return { response: { rejected: true, error: result.error } };
    }

    state.finalized = result.reasoning;
    const clinic = getClinic(state, result.reasoning.clinic_id)!;

    return {
      response: { accepted: true },
      done: true,
      step: {
        id: "recommend",
        message: result.reasoning.overrode_ranking
          ? `🏆 Recommending ${clinic.clinic_name} — overriding the top-scored option on the verified details.`
          : `🏆 Recommendation ready: ${clinic.clinic_name}.`,
      },
    };
  },
};
