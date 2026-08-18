import { AgentError } from "../../domain/entities/errors.ts";
import type { AgentStep } from "../../domain/entities/agentRun.ts";
import type { Clinic } from "../../domain/entities/clinic.ts";
import type { FunctionDeclaration } from "../gemini/functionCall.ts";
import { geocode } from "../tools/geocode.ts";
import { search_clinics } from "../tools/searchClinics.ts";
import { rank_clinics } from "../tools/rankClinics.ts";
import { inspect_clinic, mergeInspection } from "../tools/inspectClinic.ts";
import { validateFinalization } from "./guards.ts";
import {
  eligibleClinics,
  getClinic,
  project,
  recordInspection,
  recordSearch,
  shortId,
} from "./state.ts";
import type { RunState } from "./state.ts";

/** Hard ceiling on a self-corrected radius, whatever the model asks for. */
const MAX_RADIUS_KM = 25;
const RADIUS_WIDENING_FACTOR = 3;
/** Websites read per call. Bounds both latency and the free-tier Gemini quota. */
const MAX_INSPECTIONS_PER_CALL = 5;
const MAX_DETAILS_PER_CALL = 8;

export interface ToolOutcome {
  /** Sent back to the model as the functionResponse payload. */
  response: Record<string, unknown>;
  /** Appended to the transparency log and streamed to the UI. */
  step?: AgentStep;
  /** Set by finalize_recommendation to end the loop. */
  done?: boolean;
}

export type ToolExecutor = (
  state: RunState,
  args: Record<string, unknown>
) => Promise<ToolOutcome>;

export interface AgentTool {
  declaration: FunctionDeclaration;
  execute: ToolExecutor;
}

function fail(message: string): ToolOutcome {
  return { response: { error: message } };
}

function asIdList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === "string");
  return [...new Set(ids)].slice(0, cap);
}

// ---------------------------------------------------------------------------

const geocodeTool: AgentTool = {
  declaration: {
    name: "geocode_location",
    description:
      "Resolve the user's typed location into coordinates. Call this first — " +
      "search_clinics cannot run until it has.",
    parameters: {
      type: "OBJECT",
      properties: {
        location: {
          type: "STRING",
          description: "The location to resolve, as the user typed it.",
        },
      },
      required: ["location"],
    },
  },
  async execute(state, args) {
    const location =
      typeof args.location === "string" && args.location.trim()
        ? args.location
        : state.input.location;

    // A location we cannot resolve is the user's to fix, not the agent's — let
    // it propagate so the UI can show the proper error state instead of the
    // model narrating its way around a dead end.
    const place = await geocode(location);
    state.place = place;

    return {
      response: { display_name: place.display_name, lat: place.lat, lon: place.lon },
      step: {
        id: "geocode",
        message: `📍 Resolved "${location}" to ${place.display_name}.`,
      },
    };
  },
};

const searchTool: AgentTool = {
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

    // Clamped here rather than trusted from the model: an unbounded radius
    // would turn one tool call into a nationwide Overpass query.
    const ceiling = Math.min(
      state.input.maxRadiusKm * RADIUS_WIDENING_FACTOR,
      MAX_RADIUS_KM
    );
    const radiusKm = Math.min(requested, ceiling);
    const widened = state.searchedRadiusKm !== null && radiusKm > state.searchedRadiusKm;

    const { clinics, stale } = await search_clinics(state.place, radiusKm);
    const before = state.clinics.size;
    recordSearch(state, clinics, radiusKm, stale);
    const eligible = eligibleClinics(state);

    const steps: string[] = [];
    if (widened) {
      steps.push(
        `🔁 Widening the search to ${radiusKm} km — the first pass was too thin to recommend from.`
      );
    } else {
      steps.push(`🔍 Searching for clinics within ${radiusKm} km...`);
    }
    if (stale) {
      steps.push(
        "⚠️ The clinic directory didn't respond — showing the most recent results we have."
      );
    }

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
      step: {
        id: `search-${radiusKm}`,
        message: `${steps.join(" ")} Found ${eligible.length} general ${
          eligible.length === 1 ? "clinic" : "clinics"
        }${state.excluded.length > 0 ? `, set aside ${state.excluded.length} specialty` : ""}.`,
      },
    };
  },
};

const inspectTool: AgentTool = {
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

    const confirmed = results.filter((r) => r.verified_fields.length > 0);
    const detail = confirmed.length
      ? confirmed
          .map((r) => `${r.name}: ${r.verified_fields.map((f) => f.replace(/_/g, " ")).join(", ")}`)
          .join("; ")
      : "nothing verifiable on those sites — details stay Unknown";

    return {
      response: {
        results,
        skipped,
        note: "Fields absent from verified_fields could not be confirmed and remain Unknown. Absence is not evidence of the negative.",
      },
      step: {
        id: `inspect-${ids.join(",")}`,
        message: `🕵️ Read ${targets.length} clinic ${
          targets.length === 1 ? "website" : "websites"
        } — ${detail}.`,
      },
    };
  },
};

const rankTool: AgentTool = {
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

const detailsTool: AgentTool = {
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

const finalizeTool: AgentTool = {
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

export const AGENT_TOOLS: AgentTool[] = [
  geocodeTool,
  searchTool,
  inspectTool,
  rankTool,
  detailsTool,
  finalizeTool,
];

export const TOOL_DECLARATIONS: FunctionDeclaration[] = AGENT_TOOLS.map(
  (t) => t.declaration
);

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.declaration.name, t]));

/**
 * Runs one model-requested tool call. An AgentError is the user's problem to
 * fix (bad location, directory unreachable) and propagates; anything else is
 * handed back to the model as a tool error so it can adapt.
 */
export async function executeTool(
  state: RunState,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return fail(
      `No such tool "${name}". Available: ${[...BY_NAME.keys()].join(", ")}.`
    );
  }

  try {
    return await tool.execute(state, args);
  } catch (e) {
    if (e instanceof AgentError) throw e;
    console.error(`Tool ${name} failed:`, e);
    return fail(
      `${name} failed: ${e instanceof Error ? e.message : "unknown error"}. Try a different approach.`
    );
  }
}
