import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _resetSessions,
  activeSessionFor,
  CallError,
  createSession,
  getSession,
  requireSession,
  transition,
} from "./callSessionService.ts";

const CLINIC = {
  clinicId: "node/123",
  clinicName: "Riverside Walk-In Clinic",
  phone: "902-555-0142",
};

beforeEach(() => {
  _resetSessions();
});

test("a new session starts awaiting consent, not dialing", () => {
  const session = createSession(CLINIC);
  assert.equal(session.status, "awaiting_consent");
  assert.equal(session.startedAt, null);
  assert.equal(session.endedAt, null);
});

test("a clinic cannot be called twice at once", () => {
  createSession(CLINIC);
  assert.throws(
    () => createSession(CLINIC),
    (e: unknown) => e instanceof CallError && e.kind === "already_active"
  );
});

test("a finished call frees the clinic for another", () => {
  const first = createSession(CLINIC);
  transition(first, "dialing");
  transition(first, "no_answer");

  assert.equal(activeSessionFor(CLINIC.clinicId), undefined);
  assert.doesNotThrow(() => createSession(CLINIC));
});

test("a different clinic is unaffected by an active call", () => {
  createSession(CLINIC);
  assert.doesNotThrow(() =>
    createSession({ ...CLINIC, clinicId: "node/999", clinicName: "Other Clinic" })
  );
});

test("connecting records a start time, ending records an end time", () => {
  let clock = 1000;
  const now = () => clock;
  const session = createSession(CLINIC, now);

  transition(session, "dialing", now);
  clock = 5000;
  transition(session, "in_progress", now);
  assert.equal(session.startedAt, 5000);

  clock = 20000;
  transition(session, "completed", now);
  assert.equal(session.endedAt, 20000);
});

test("an illegal transition throws rather than sliding through", () => {
  const session = createSession(CLINIC);
  // Skipping straight from consent to completed would mean reporting an
  // outcome for a call that was never placed.
  assert.throws(
    () => transition(session, "completed"),
    (e: unknown) => e instanceof CallError && e.kind === "illegal_transition"
  );
});

test("a terminal call cannot be restarted", () => {
  const session = createSession(CLINIC);
  transition(session, "dialing");
  transition(session, "no_answer");

  assert.throws(
    () => transition(session, "in_progress"),
    (e: unknown) => e instanceof CallError && e.kind === "illegal_transition"
  );
});

test("the user can hang up at every live stage", () => {
  for (const stage of ["awaiting_consent", "dialing", "in_progress"] as const) {
    _resetSessions();
    const session = createSession(CLINIC);
    if (stage !== "awaiting_consent") transition(session, "dialing");
    if (stage === "in_progress") transition(session, "in_progress");

    assert.doesNotThrow(() => transition(session, "aborted"));
    assert.equal(session.status, "aborted");
  }
});

test("a call that never connects can still end as no_answer", () => {
  const session = createSession(CLINIC);
  transition(session, "dialing");
  assert.doesNotThrow(() => transition(session, "no_answer"));
});

test("requireSession names a missing call rather than returning undefined", () => {
  assert.equal(getSession("nope"), undefined);
  assert.throws(
    () => requireSession("nope"),
    (e: unknown) => e instanceof CallError && e.kind === "not_found"
  );
});
