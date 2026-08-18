import type { AgentRunResult, AgentStep, InputFormData } from "../../domain/entities/agentRun.ts";
import type { RankedClinic } from "../../domain/entities/clinic.ts";
import type { Content, ModelCallable, Part } from "../../infrastructure/llm/geminiFunctionCallClient.ts";
import { rank_clinics } from "../../domain/policies/rankClinics.ts";
import { executeTool } from "./toolRegistry.ts";
import type { ToolOutcome } from "./toolRegistry.ts";
import { createRunState, eligibleClinics, shortId } from "./state.ts";
import type { RunState } from "./state.ts";

/** Model turns per run. Each is a network round-trip against the free-tier quota. */
export const MAX_STEPS = 10;
/**
 * Wall-clock ceiling for the whole loop. Vercel's Hobby plan kills a function
 * at 60s, and the caller still needs time to fall back and answer, so the loop
 * gives up well before that rather than dying mid-stream.
 */
export const AGENT_BUDGET_MS = 40_000;

export interface AgentRunOptions {
  input: InputFormData;
  callModel: ModelCallable;
  onStep: (step: AgentStep) => void;
  /** Injectable clock, matching the pattern in infrastructure/cache/ttlCache.ts. */
  now?: () => number;
  /**
   * Injectable tool dispatch, defaulting to the real registry. Lets a test
   * exercise turn management, budget and termination without the network.
   */
  runTool?: (
    state: RunState,
    name: string,
    args: Record<string, unknown>
  ) => Promise<ToolOutcome>;
}

export type AgentOutcome =
  | { ok: true; result: AgentRunResult }
  | { ok: false; reason: string };

const SYSTEM_INSTRUCTION = `You are ClinicScout, an agent that finds someone a walk-in medical clinic they can actually get seen at today.

You decide which tools to call and in what order. A sensible run is: geocode the location, search for clinics, score them with rank_clinics, inspect the websites of the plausible front-runners, check the details, then finalize. Deviate when the situation calls for it.

Before each tool call, briefly explain what you are doing and why — this helps the user follow your reasoning. Then call the tool.

URGENCY changes what a good answer looks like:
- routine: needing an appointment is fine, so do not penalise it.
- urgent / emergency_adjacent: being open dominates everything else. Never recommend a clinic confirmed closed while any alternative might be open — the best walk-in policy in the city is worth nothing if the door is locked right now. Unknown hours beat confirmed closed, because unknown might be open. If every option is confirmed closed, say so plainly instead of dressing one up as a good pick.

A RECOMMENDATION MUST BE USABLE. Before anything else, check these two — they are enforced, and a finalization that breaks either will be rejected:
1. The user must be able to reach it or find it. A listing with no address, no phone, no email and no booking link is a name, not a recommendation, however well it scores otherwise.
2. It must not be confirmed closed when the need is urgent. Unknown hours are fine — unknown might be open — but a verified closure is not.
Both rules lift only when every alternative fails the same way; if so, say that plainly rather than pretending the pick is good.

ABSOLUTE RULES:
- Never state a clinic fact that did not come back from a tool. You cannot look anything up; you can only report what the tools confirmed.
- A null field means Unknown, NOT false. A clinic with accepts_walk_ins: null has not said it refuses walk-ins — it has said nothing.
- Every field you cite in finalize_recommendation must already be confirmed for that clinic. A citation that is not will be rejected and you will have to correct it.
- rank_clinics is an expert scoring input, not a verdict. You may recommend a lower-ranked clinic when the verified details justify it — say so plainly in your reason when you do. But an override must cite at least one confirmed fact: distance, confidence and relevance are already weighed by the ranking, so overruling it requires something it could not see. An Unknown field is never a reason to prefer a clinic; it is the absence of one. With nothing to cite, finalize the top-scored clinic.

SELF-CORRECTION — do this rather than settling for a weak answer:
- Very few eligible clinics, or none open when the need is urgent: search again with a larger radius.
- The front-runners had nothing verifiable on their sites: inspect the next few candidates down.
- Everything nearby was filtered out as specialty care: widen the radius.

Be efficient — you have a strict time budget and about ${MAX_STEPS} turns. Inspect the handful of clinics that could plausibly win, not every result. When you have enough to justify a pick, finalize; do not keep gathering.`;

function openingMessage(input: InputFormData): string {
  return [
    `Find a walk-in clinic for this request:`,
    `- location: ${input.location}`,
    `- urgency: ${input.urgency}`,
    `- preferred radius: ${input.maxRadiusKm} km`,
    ``,
    `Work through it and finish by calling finalize_recommendation.`,
  ].join("\n");
}

/**
 * Puts the agent's pick at the head of the list and renumbers.
 *
 * The deterministic order is kept underneath it, so an override reorders one
 * entry rather than discarding the scoring — and the UI, which renders
 * `ranked[0]` as the recommendation, needs no knowledge of any of this.
 */
function promote(ranked: RankedClinic[], clinicId: string): RankedClinic[] {
  const index = ranked.findIndex((c) => shortId(c.source_url) === clinicId);
  if (index <= 0) return ranked;
  const reordered = [ranked[index], ...ranked.filter((_, i) => i !== index)];
  return reordered.map((c, i) => ({ ...c, rank: i + 1 }));
}

function buildResult(state: RunState, mode: "agent" | "deterministic"): AgentRunResult {
  const scored = rank_clinics(eligibleClinics(state), state.input.urgency);
  const ranked =
    mode === "agent" && state.finalized
      ? promote(scored, state.finalized.clinic_id)
      : scored;

  return {
    steps: [],
    ranked,
    resolvedLocation: state.place?.display_name ?? state.input.location,
    urgency: state.input.urgency,
    excluded: state.excluded,
    mode,
    agentReasoning: mode === "agent" ? state.finalized : null,
  };
}

/**
 * Why a run stopped short. Named accurately rather than lumped under one
 * message: "the AI quota ran out" and "the agent thought for too long" are
 * different problems with different fixes, and this app's whole habit is
 * saying which is which instead of papering over it.
 */
const SALVAGE_NOTE: Record<string, string> = {
  budget:
    "⏱️ The agent ran out of time to finish reasoning — ranking what it had gathered instead.",
  turns:
    "🔁 The agent used all its turns without settling — ranking what it had gathered instead.",
  no_finalize:
    "🤔 The agent stopped without committing to a pick — ranking what it had gathered instead.",
  quota:
    "📉 The AI quota ran out mid-run — ranking what the agent had already gathered.",
  network:
    "📉 Lost contact with the model mid-run — ranking what the agent had already gathered.",
};

/**
 * The loop stopped short, but the work it already did is still good: the
 * clinics are found and some are enriched. Scoring what we have beats
 * discarding it and re-running the whole pipeline from scratch.
 */
function salvage(
  state: RunState,
  onStep: (s: AgentStep) => void,
  reason: string
): AgentOutcome {
  // Having found clinics is the whole precondition: buildResult already falls
  // back to the location the user typed when no geocode was recorded.
  if (state.clinics.size === 0) {
    return { ok: false, reason };
  }
  onStep({
    id: "salvage",
    message:
      SALVAGE_NOTE[reason] ??
      "🧭 The agent couldn't finish its reasoning — ranking what it had gathered instead.",
  });
  return { ok: true, result: buildResult(state, "deterministic") };
}

/**
 * The orchestrator loop. Gemini chooses the tools; this function only enforces
 * the budget, ferries results back, and streams a step per action.
 *
 * `callModel` is a parameter rather than an import so a test can drive an
 * entire run from a scripted transcript without a key or a network.
 */
export async function runGeminiAgent(
  options: AgentRunOptions
): Promise<AgentOutcome> {
  const {
    input,
    callModel,
    onStep,
    now = Date.now,
    runTool = executeTool,
  } = options;
  const state = createRunState(input);
  const deadline = now() + AGENT_BUDGET_MS;

  const contents: Content[] = [
    { role: "user", parts: [{ text: openingMessage(input) }] },
  ];
  /** One reminder to finalize, so a chatty model does not silently cost a run. */
  let nudged = false;

  for (let turn = 0; turn < MAX_STEPS; turn++) {
    if (now() > deadline) return salvage(state, onStep, "budget");

    const modelTurn = await callModel(contents);

    if (modelTurn.kind === "failed") {
      // Distinguishes "the model is unreachable" from "the model is done": only
      // the former should hand the whole run to the deterministic fallback.
      return salvage(state, onStep, modelTurn.reason);
    }

    if (modelTurn.kind === "text") {
      if (state.finalized) return { ok: true, result: buildResult(state, "agent") };

      // It answered in prose instead of committing. Prose is not a
      // recommendation — nothing in it has been checked against the record — so
      // ask once for a real finalization before giving up on the agent path.
      // Smaller models in particular tend to narrate a conclusion and stop.
      if (!nudged) {
        nudged = true;
        contents.push({ role: "model", parts: [{ text: modelTurn.text }] });
        contents.push({
          role: "user",
          parts: [
            {
              text:
                "You have not finished yet. A written answer is not a recommendation — " +
                "it is only recorded when you call finalize_recommendation. Call it now " +
                "with the clinic you chose, a reason, and the cited_fields your reason relies on.",
            },
          ],
        });
        continue;
      }

      return salvage(state, onStep, "no_finalize");
    }

    // Replayed verbatim when the client supplied the raw parts: Gemini 3.x
    // rejects a functionCall echoed back without its thought signature, and
    // rebuilding the turn ourselves would strip it.
    const modelParts = modelTurn.parts ?? modelTurn.calls.map((call) => ({ functionCall: call }));
    contents.push({
      role: "model",
      parts: modelParts,
    });

    // Emit any reasoning text the model included before its tool calls, so the user
    // sees what it's thinking about rather than just the tool effects.
    if (modelTurn.parts) {
      for (const part of modelTurn.parts) {
        if ("text" in part && part.text) {
          onStep({
            id: `reasoning-${turn}`,
            message: `🤔 ${part.text}`,
          });
        }
      }
    }

    const responseParts: Part[] = [];
    let done = false;

    for (const call of modelTurn.calls) {
      const outcome = await runTool(state, call.name, call.args ?? {});
      if (outcome.step) onStep(outcome.step);
      responseParts.push({
        functionResponse: { name: call.name, response: outcome.response },
      });
      if (outcome.done) done = true;
    }

    // Appended even when finishing, so the transcript stays well-formed — every
    // functionCall is answered — for anyone reading a logged run.
    contents.push({ role: "user", parts: responseParts });

    if (done) return { ok: true, result: buildResult(state, "agent") };
  }

  return salvage(state, onStep, "turns");
}

export { SYSTEM_INSTRUCTION };
