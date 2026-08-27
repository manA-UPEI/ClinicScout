import type {
  CallableOptions,
  Content,
  ModelCallable,
  ModelFunctionCall,
  ModelTurn,
  Part,
} from "../llm/geminiFunctionCallClient.ts";

/**
 * A scripted stand-in for Gemini's function-calling loop.
 *
 * It plays the run the system instruction describes as sensible — geocode,
 * search, rank, inspect the front-runners, check the details, finalize — but
 * it is not a fixed list of turns. Each call re-reads the transcript it was
 * handed, works out which tools have already answered, and picks the next
 * step from that. Two things follow, and both matter:
 *
 * - It uses the *real* tool results. Clinic ids, the ranking order, and which
 *   fields ended up confirmed are all read out of the actual responses, so
 *   the fixture exercises the genuine tools, state machine, verification
 *   firewall and citation guard rather than replaying a recording of them.
 * - It cannot drift out of sync. A transcript-driven decision has no cursor
 *   to get wrong when the loop retries a turn, nudges, or fans several calls
 *   into one turn.
 *
 * What it deliberately does not do is imitate a model's mistakes. It cites
 * only fields the record confirms, so `finalize_recommendation` is accepted
 * first time. The rejection-and-retry path is real behaviour worth testing,
 * but the unit suite already drives it directly with a scripted transcript;
 * making every fixture run take it would just be noise while you are looking
 * at something else.
 */

interface ToolResponse {
  name: string;
  response: Record<string, unknown>;
}

function functionResponses(contents: Content[]): ToolResponse[] {
  const out: ToolResponse[] = [];
  for (const content of contents) {
    for (const part of content.parts) {
      if ("functionResponse" in part) out.push(part.functionResponse);
    }
  }
  return out;
}

/** The most recent response from `name`, or undefined if it has never answered. */
function latest(responses: ToolResponse[], name: string): Record<string, unknown> | undefined {
  for (let i = responses.length - 1; i >= 0; i--) {
    if (responses[i].name === name) return responses[i].response;
  }
  return undefined;
}

interface ProjectedClinic {
  id: string;
  has_website?: boolean;
}

interface RankedEntry {
  id: string;
  name: string;
}

/** Websites are the expensive tool, so this mirrors the instruction's "plausible front-runners, not everything". */
const MAX_INSPECT = 2;

function clinicsToInspect(
  search: Record<string, unknown> | undefined,
  ranked: RankedEntry[]
): string[] {
  const clinics = (search?.clinics as ProjectedClinic[] | undefined) ?? [];
  const withSite = new Set(
    clinics.filter((c) => c.has_website).map((c) => c.id)
  );
  // Ranked order, filtered to the ones that actually have a site to read —
  // passing an id with no website just earns a "skipped" back from the tool.
  return ranked.map((r) => r.id).filter((id) => withSite.has(id)).slice(0, MAX_INSPECT);
}

/** The citable fields `get_clinic_details` reports as actually confirmed for this clinic. */
function confirmedFields(details: Record<string, unknown> | undefined, id: string): string[] {
  const entries = (details?.details as Record<string, unknown>[] | undefined) ?? [];
  const record = entries.find((d) => d.id === id);
  if (!record) return [];

  return (
    ["accepts_walk_ins", "appointment_required", "opening_hours", "current_capacity"] as const
  ).filter((field) => {
    const value = record[field];
    return value !== null && value !== undefined && value !== "";
  });
}

function turn(text: string, call: ModelFunctionCall): ModelTurn {
  const parts: Part[] = [{ text }, { functionCall: call }];
  return { kind: "calls", calls: [call], parts };
}

/**
 * `options` is accepted and ignored: the system instruction and tool
 * declarations are what a real model would reason over, and this one already
 * knows the plan. Taking the same argument keeps it a drop-in for
 * `createGeminiCallable`.
 */
export function createFixtureCallable(options: CallableOptions): ModelCallable {
  void options;

  return async (contents: Content[]): Promise<ModelTurn> => {
    const responses = functionResponses(contents);

    if (!latest(responses, "geocode_location")) {
      const location = contents[0]?.parts
        .map((p) => ("text" in p ? p.text : ""))
        .join("\n")
        .match(/<user_location>([\s\S]*?)<\/user_location>/)?.[1]
        ?.trim();

      return turn("Starting with the location so I can search around it.", {
        name: "geocode_location",
        args: { location: location ?? "" },
      });
    }

    const search = latest(responses, "search_clinics");
    if (!search) {
      return turn("Looking for clinics near there.", {
        name: "search_clinics",
        args: {},
      });
    }

    const rank = latest(responses, "rank_clinics");
    if (!rank) {
      return turn("Scoring what came back before I read any websites.", {
        name: "rank_clinics",
        args: {},
      });
    }

    const ranked = (rank.ranked as RankedEntry[] | undefined) ?? [];
    if (ranked.length === 0) {
      return {
        kind: "text",
        text: "Nothing eligible came back for that search, so there is no clinic I can honestly recommend.",
      };
    }

    if (!latest(responses, "inspect_clinic_websites")) {
      const targets = clinicsToInspect(search, ranked);
      if (targets.length > 0) {
        return turn("Reading the front-runners' own sites to confirm the details.", {
          name: "inspect_clinic_websites",
          args: { clinic_ids: targets },
        });
      }
    }

    const top = ranked[0];
    const details = latest(responses, "get_clinic_details");
    if (!details) {
      return turn("Checking exactly what was confirmed before I commit.", {
        name: "get_clinic_details",
        args: { clinic_ids: [top.id] },
      });
    }

    const cited = confirmedFields(details, top.id);
    return turn(`${top.name} is the best of these — finalizing.`, {
      name: "finalize_recommendation",
      args: {
        clinic_id: top.id,
        reason: `${top.name} scores highest on the ranking and its confirmed details back that up.`,
        cited_fields: cited,
      },
    });
  };
}
