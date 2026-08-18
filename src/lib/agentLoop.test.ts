import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEPS, runGeminiAgent } from "./agent/runGeminiAgent.ts";
import { recordSearch, shortId } from "./agent/state.ts";
import type { RunState } from "./agent/state.ts";
import type { ToolOutcome } from "./agent/toolRegistry.ts";
import type { ModelTurn } from "./gemini/functionCall.ts";
import type { AgentStep, Clinic, InputFormData } from "./types.ts";

const INPUT: InputFormData = {
  location: "Charlottetown, PEI",
  urgency: "urgent",
  maxRadiusKm: 5,
};

function clinic(id: number, overrides: Partial<Clinic> = {}): Clinic {
  return {
    clinic_name: `Clinic ${id}`,
    address: "1 Main St",
    distance_km: id,
    phone: "555-0100",
    email: null,
    website: "https://example.com",
    source_url: `https://www.openstreetmap.org/node/${id}`,
    opening_hours: null,
    open_now: null,
    current_capacity: null,
    accepts_walk_ins: null,
    appointment_required: null,
    booking_url: null,
    email_booking_supported: null,
    confidence: "Medium",
    relevance: "general",
    specialty: null,
    evidence: [],
    ...overrides,
  };
}

/** Replays a fixed list of model turns, then reports the model as finished. */
function scriptedModel(turns: ModelTurn[]) {
  let i = 0;
  return async () => turns[i++] ?? { kind: "text" as const, text: "done" };
}

/**
 * Stand-in tool dispatch: seeds state on a search, accepts a finalization, and
 * records what was called. Keeps the loop's own responsibilities — turn
 * management, budget, termination, step emission — under test without a network.
 */
function fakeTools(clinics: Clinic[]) {
  const calls: string[] = [];

  const runTool = async (
    state: RunState,
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolOutcome> => {
    calls.push(name);

    if (name === "geocode_location") {
      state.place = { lat: 46.2, lon: -63.1, display_name: "Charlottetown, PE" };
      return { response: { display_name: "Charlottetown, PE" } };
    }
    if (name === "search_clinics") {
      recordSearch(state, clinics, INPUT.maxRadiusKm, false);
      return {
        response: { eligible_count: clinics.length },
        step: { id: "search", message: "🔍 searched" },
      };
    }
    if (name === "finalize_recommendation") {
      const id = String(args.clinic_id);
      state.finalized = {
        clinic_id: id,
        reason: "Chosen for the test.",
        cited_fields: [],
        overrode_ranking: false,
      };
      return {
        response: { accepted: true },
        done: true,
        step: { id: "recommend", message: "🏆 done" },
      };
    }
    if (name === "explode") throw new Error("tool blew up");
    return { response: {} };
  };

  return { runTool, calls };
}

function callTurn(name: string, args: Record<string, unknown> = {}): ModelTurn {
  return { kind: "calls", calls: [{ name, args }] };
}

test("a scripted run reaches a finalized agent recommendation", async () => {
  const clinics = [clinic(1), clinic(2)];
  const { runTool, calls } = fakeTools(clinics);
  const steps: AgentStep[] = [];

  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: scriptedModel([
      callTurn("geocode_location", { location: INPUT.location }),
      callTurn("search_clinics"),
      callTurn("finalize_recommendation", { clinic_id: "node/2" }),
    ]),
    onStep: (s) => steps.push(s),
    runTool,
  });

  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.equal(outcome.result.mode, "agent");
  assert.equal(outcome.result.agentReasoning?.clinic_id, "node/2");
  assert.deepEqual(calls, [
    "geocode_location",
    "search_clinics",
    "finalize_recommendation",
  ]);
  // Only tools that returned a step should have emitted one.
  assert.deepEqual(steps.map((s) => s.id), ["search", "recommend"]);
});

test("the agent's pick is promoted to the head of the ranked list", async () => {
  // Clinic 2 is further away, so the deterministic waterfall ranks it second.
  const { runTool } = fakeTools([clinic(1), clinic(2)]);

  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: scriptedModel([
      callTurn("search_clinics"),
      callTurn("finalize_recommendation", { clinic_id: "node/2" }),
    ]),
    onStep: () => {},
    runTool,
  });

  assert.ok(outcome.ok);
  assert.equal(shortId(outcome.result.ranked[0].source_url), "node/2");
  assert.equal(outcome.result.ranked[0].rank, 1);
  // The rest of the ordering survives underneath, renumbered.
  assert.equal(shortId(outcome.result.ranked[1].source_url), "node/1");
  assert.equal(outcome.result.ranked[1].rank, 2);
});

test("an unreachable model with nothing gathered yields no result", async () => {
  const { runTool } = fakeTools([clinic(1)]);

  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: async () => ({ kind: "failed", reason: "quota" }),
    onStep: () => {},
    runTool,
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.reason, "quota");
});

test("an unreachable model salvages work already done", async () => {
  const { runTool } = fakeTools([clinic(1), clinic(2)]);
  const steps: AgentStep[] = [];
  let turn = 0;

  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: async (): Promise<ModelTurn> =>
      turn++ === 0
        ? callTurn("search_clinics")
        : { kind: "failed", reason: "quota" },
    onStep: (s) => steps.push(s),
    runTool,
  });

  assert.ok(outcome.ok);
  // Salvaged, so it is honest about not being the agent's own answer.
  assert.equal(outcome.result.mode, "deterministic");
  assert.equal(outcome.result.ranked.length, 2);
  assert.equal(outcome.result.agentReasoning, null);

  // And honest about *why*. Quota exhaustion is the failure this app actually
  // hits in a live demo; reporting it as "ran out of time" would send anyone
  // debugging it after the wrong problem.
  const salvageStep = steps.find((s) => s.id === "salvage");
  assert.ok(salvageStep);
  assert.match(salvageStep.message, /quota/i);
  assert.doesNotMatch(salvageStep.message, /out of time/i);
});

test("running out of turns is reported as turns, not as quota", async () => {
  const { runTool } = fakeTools([clinic(1)]);
  const steps: AgentStep[] = [];
  let turn = 0;

  await runGeminiAgent({
    input: INPUT,
    callModel: async (): Promise<ModelTurn> =>
      turn++ === 0 ? callTurn("search_clinics") : callTurn("get_clinic_details"),
    onStep: (s) => steps.push(s),
    runTool,
  });

  const salvageStep = steps.find((s) => s.id === "salvage");
  assert.ok(salvageStep);
  assert.match(salvageStep.message, /turns/i);
});

test("exceeding the wall-clock budget salvages instead of looping on", async () => {
  const { runTool, calls } = fakeTools([clinic(1)]);
  let clock = 0;

  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: scriptedModel([callTurn("search_clinics")]),
    onStep: () => {},
    runTool,
    // Jumps past the budget after the first turn.
    now: () => {
      clock += 30_000;
      return clock;
    },
  });

  assert.ok(outcome.ok);
  assert.equal(outcome.result.mode, "deterministic");
  assert.deepEqual(calls, ["search_clinics"]);
});

test("the loop stops at MAX_STEPS rather than running forever", async () => {
  const { runTool, calls } = fakeTools([clinic(1)]);

  // A model that never finalizes: search, then request details forever.
  let turn = 0;
  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: async (): Promise<ModelTurn> =>
      turn++ === 0 ? callTurn("search_clinics") : callTurn("get_clinic_details"),
    onStep: () => {},
    runTool,
  });

  assert.ok(outcome.ok);
  assert.equal(outcome.result.mode, "deterministic");
  assert.equal(calls.length, MAX_STEPS);
});

test("a tool that throws does not abort the run", async () => {
  const { runTool } = fakeTools([clinic(1)]);

  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: scriptedModel([
      callTurn("search_clinics"),
      callTurn("explode"),
      callTurn("finalize_recommendation", { clinic_id: "node/1" }),
    ]),
    onStep: () => {},
    // The real registry converts a throw into a tool error; this stand-in lets
    // it escape, so the loop's own resilience is what is being checked.
    runTool: async (state, name, args) => {
      try {
        return await runTool(state, name, args);
      } catch (e) {
        return { response: { error: String(e) } };
      }
    },
  });

  assert.ok(outcome.ok);
  assert.equal(outcome.result.mode, "agent");
});

test("a model that answers in prose is nudged once, and its finalization counts", async () => {
  const { runTool } = fakeTools([clinic(1)]);
  let turn = 0;

  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: async (): Promise<ModelTurn> => {
      turn++;
      if (turn === 1) return callTurn("search_clinics");
      // Narrates a conclusion instead of committing — what small models do.
      if (turn === 2) return { kind: "text", text: "Clinic 1 is the best option." };
      return callTurn("finalize_recommendation", { clinic_id: "node/1" });
    },
    onStep: () => {},
    runTool,
  });

  assert.ok(outcome.ok);
  assert.equal(outcome.result.mode, "agent");
  assert.equal(outcome.result.agentReasoning?.clinic_id, "node/1");
});

test("a model that stops talking without finalizing does not invent a result", async () => {
  const { runTool } = fakeTools([clinic(1)]);

  const outcome = await runGeminiAgent({
    input: INPUT,
    callModel: scriptedModel([
      callTurn("search_clinics"),
      { kind: "text", text: "I think clinic 1 looks good." },
    ]),
    onStep: () => {},
    runTool,
  });

  assert.ok(outcome.ok);
  // Its prose is discarded — only a real finalization counts as an agent answer.
  assert.equal(outcome.result.mode, "deterministic");
  assert.equal(outcome.result.agentReasoning, null);
});
