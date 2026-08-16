import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMockProvider, PERSONAS } from "./call/providers/mock.ts";
import type { PersonaId } from "./call/providers/mock.ts";
import { _resetSessions, createSession } from "./call/session.ts";
import { runCall } from "./call/runCall.ts";
import type { CallOutcome, CallStatus } from "./call/types.ts";

/** Instant pacing — the delays exist for the UI, not for the logic. */
function instantProvider(persona: PersonaId) {
  return createMockProvider({
    persona,
    agentPaceMs: 0,
    clinicPaceMs: 0,
    ringMs: 0,
  });
}

async function call(persona: PersonaId, signal?: AbortSignal) {
  const session = createSession({
    clinicId: `node/${persona}`,
    clinicName: "Riverside Walk-In Clinic",
    phone: "902-555-0142",
  });
  const outcome = await runCall(session, instantProvider(persona), () => {}, signal);
  return { session, outcome };
}

beforeEach(() => {
  _resetSessions();
});

const EXPECTED: Record<PersonaId, CallStatus> = {
  books_it: "completed",
  no_walk_ins: "completed",
  vague_answers: "completed",
  declines_ai: "declined_ai",
  voicemail: "voicemail",
  ivr_maze: "ivr_blocked",
  no_answer: "no_answer",
};

test("every persona reaches its expected terminal status", async () => {
  for (const persona of Object.keys(PERSONAS) as PersonaId[]) {
    _resetSessions();
    const { outcome, session } = await call(persona);
    assert.equal(outcome.status, EXPECTED[persona], `persona ${persona}`);
    assert.equal(session.status, EXPECTED[persona], `persona ${persona}`);
    assert.notEqual(session.endedAt, null, `persona ${persona} should have ended`);
  }
});

test("a helpful clinic yields facts traceable to its own words", async () => {
  const { outcome, session } = await call("books_it");

  const byField = new Map(outcome.findings.map((f) => [f.field, f]));
  assert.equal(byField.get("accepts_walk_ins_today")?.value, "Yes");
  assert.equal(byField.get("current_wait")?.value, "45 minutes");

  // Each surviving finding must point at a turn the clinic actually spoke.
  for (const finding of outcome.findings) {
    const turn = session.transcript[finding.turnIndex];
    assert.equal(turn.speaker, "clinic");
    assert.ok(turn.text.toLowerCase().includes(finding.quote.toLowerCase()));
  }
});

test("an appointment-only clinic is not read as accepting walk-ins", async () => {
  const { outcome } = await call("no_walk_ins");
  const walkIns = outcome.findings.find(
    (f) => f.field === "accepts_walk_ins_today"
  );
  assert.equal(walkIns?.value, "No");
});

test("a vague clinic confirms nothing at all", async () => {
  // The headline case. A friendly receptionist who says "maybe, hard to say"
  // has told us nothing, and the only correct outcome is an empty one. A
  // system that produces a wait time here invented it.
  const { outcome, session } = await call("vague_answers");

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.findings, []);
  assert.ok(
    session.transcript.some((t) => t.speaker === "clinic"),
    "the call should still have happened"
  );
});

test("a refusal ends the call and withdraws politely", async () => {
  const { outcome, session } = await call("declines_ai");

  assert.equal(outcome.status, "declined_ai");
  const last = session.transcript[session.transcript.length - 1];
  assert.equal(last.speaker, "agent");
  assert.match(last.text, /call you directly/i);

  // It must not have carried on asking its questions after being refused.
  const asked = session.transcript.filter((t) =>
    /accepting walk-in patients today/i.test(t.text)
  );
  assert.equal(asked.length, 0);
});

test("voicemail is never mined for facts", async () => {
  const { outcome } = await call("voicemail");
  assert.equal(outcome.status, "voicemail");
  assert.deepEqual(outcome.findings, []);
});

test("the agent does not read its script at a phone tree", async () => {
  const { outcome, session } = await call("ivr_maze");

  assert.equal(outcome.status, "ivr_blocked");
  const agentTurns = session.transcript.filter((t) => t.speaker === "agent");
  assert.equal(agentTurns.length, 1);
  assert.match(agentTurns[0].text, /automated menu/i);
});

test("nobody answering leaves an empty transcript, not a failure", async () => {
  const { outcome, session } = await call("no_answer");
  assert.equal(outcome.status, "no_answer");
  assert.deepEqual(session.transcript, []);
});

test("hanging up mid-call ends it as aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  const { outcome } = await call("books_it", controller.signal);
  assert.equal(outcome.status, "aborted");
  assert.deepEqual(outcome.findings, []);
});

test("the disclosure is delivered before any question is asked", async () => {
  const { session } = await call("books_it");
  const firstAgentTurn = session.transcript.find((t) => t.speaker === "agent");

  assert.ok(firstAgentTurn);
  assert.match(firstAgentTurn.text, /not a person/i);
});

test("events stream in the order the UI needs them", async () => {
  const session = createSession({
    clinicId: "node/stream",
    clinicName: "Riverside Walk-In Clinic",
    phone: "902-555-0142",
  });
  const kinds: string[] = [];
  const outcome: CallOutcome = await runCall(
    session,
    instantProvider("books_it"),
    (e) => kinds.push(e.kind)
  );

  assert.equal(kinds[0], "status");
  assert.equal(kinds[kinds.length - 1], "outcome");
  assert.ok(kinds.includes("turn"));
  assert.equal(outcome.status, "completed");
});
