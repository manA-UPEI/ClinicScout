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

test("a new session starts awaiting consent, not dialing", async () => {
  const session = await createSession(CLINIC);
  assert.equal(session.status, "awaiting_consent");
  assert.equal(session.startedAt, null);
  assert.equal(session.endedAt, null);
});

test("a clinic cannot be called twice at once", async () => {
  await createSession(CLINIC);
  await assert.rejects(
    () => createSession(CLINIC),
    (e: unknown) => e instanceof CallError && e.kind === "already_active"
  );
});

test("a finished call frees the clinic for another", async () => {
  const first = await createSession(CLINIC);
  await transition(first, "dialing");
  await transition(first, "no_answer");

  assert.equal(await activeSessionFor(CLINIC.clinicId), undefined);
  await assert.doesNotReject(() => createSession(CLINIC));
});

test("a different clinic is unaffected by an active call", async () => {
  await createSession(CLINIC);
  await assert.doesNotReject(() =>
    createSession({ ...CLINIC, clinicId: "node/999", clinicName: "Other Clinic" })
  );
});

test("connecting records a start time, ending records an end time", async () => {
  let clock = 1000;
  const now = () => clock;
  const session = await createSession(CLINIC, now);

  await transition(session, "dialing", now);
  clock = 5000;
  await transition(session, "in_progress", now);
  assert.equal(session.startedAt, 5000);

  clock = 20000;
  await transition(session, "completed", now);
  assert.equal(session.endedAt, 20000);
});

test("an illegal transition throws rather than sliding through", async () => {
  const session = await createSession(CLINIC);
  // Skipping straight from consent to completed would mean reporting an
  // outcome for a call that was never placed.
  await assert.rejects(
    () => transition(session, "completed"),
    (e: unknown) => e instanceof CallError && e.kind === "illegal_transition"
  );
});

test("a terminal call cannot be restarted", async () => {
  const session = await createSession(CLINIC);
  await transition(session, "dialing");
  await transition(session, "no_answer");

  await assert.rejects(
    () => transition(session, "in_progress"),
    (e: unknown) => e instanceof CallError && e.kind === "illegal_transition"
  );
});

test("the user can hang up at every live stage", async () => {
  for (const stage of ["awaiting_consent", "dialing", "in_progress"] as const) {
    _resetSessions();
    const session = await createSession(CLINIC);
    if (stage !== "awaiting_consent") await transition(session, "dialing");
    if (stage === "in_progress") await transition(session, "in_progress");

    await assert.doesNotReject(() => transition(session, "aborted"));
    assert.equal(session.status, "aborted");
  }
});

test("a call that never connects can still end as no_answer", async () => {
  const session = await createSession(CLINIC);
  await transition(session, "dialing");
  await assert.doesNotReject(() => transition(session, "no_answer"));
});

test("requireSession names a missing call rather than returning undefined", async () => {
  assert.equal(await getSession("nope"), undefined);
  await assert.rejects(
    () => requireSession("nope"),
    (e: unknown) => e instanceof CallError && e.kind === "not_found"
  );
});
