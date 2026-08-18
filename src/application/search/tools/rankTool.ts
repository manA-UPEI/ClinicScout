import { rank_clinics } from "../../../domain/policies/rankClinics.ts";
import { eligibleClinics, shortId } from "../agentState.ts";
import { fail } from "./shared.ts";
import type { AgentTool } from "./shared.ts";

export const rankTool: AgentTool = {
  declaration: {
    name: "rank_clinics",
    description:
      "Score every clinic found so far with the app's deterministic ranking " +
      "waterfall (usable at all > open now > relevance > confirmed walk-ins > " +
      "capacity > no appointment needed > reachable > distance > confidence) and " +
      "return them in order with a rationale each. This is an expert scoring " +
      "input, not a verdict — you may recommend a different clinic if the " +
      "verified facts justify it, but say why.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  async execute(state) {
    const eligible = eligibleClinics(state);
    if (eligible.length === 0) {
      return fail("No clinics found yet. Call search_clinics first.");
    }

    const ranked = rank_clinics(eligible, state.input.urgency);
    return {
      response: {
        urgency: state.input.urgency,
        ranked: ranked.map((c) => ({
          id: shortId(c.source_url),
          name: c.clinic_name,
          rank: c.rank,
          rationale: c.rationale,
        })),
      },
      step: {
        id: `rank-${eligible.length}`,
        message: `⚖️ Scored ${eligible.length} ${
          eligible.length === 1 ? "option" : "options"
        } — ${ranked.filter((c) => c.open_now === true).length} confirmed open.`,
      },
    };
  },
};
