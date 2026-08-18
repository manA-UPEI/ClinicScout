import { isTerminal } from "../../domain/entities/call.ts";
import type { CallOutcome, CallSession, CallStatus, CallTurn } from "../../domain/entities/call.ts";
import { callSessionStore } from "../../infrastructure/call/createCallSessionStore.ts";
import { clearInMemorySessions } from "../../infrastructure/call/inMemoryCallSessionStore.ts";

/**
 * The call lifecycle rules. Storage itself lives behind a CallSessionStore
 * (application/ports/callSessionStore.ts — in-memory or Redis, chosen by
 * infrastructure/call/createCallSessionStore.ts); what is enforced here is
 * which transitions are legal and the anti-abuse rail on concurrent calls.
 */

/** Legal transitions. Anything absent is a bug, and throws rather than silently sliding through. */
const ALLOWED: Record<CallStatus, readonly CallStatus[]> = {
  awaiting_consent: ["dialing", "aborted"],
  dialing: ["in_progress", "no_answer", "voicemail", "ivr_blocked", "failed", "aborted"],
  in_progress: ["completed", "declined_ai", "ivr_blocked", "voicemail", "failed", "aborted"],
  completed: [],
  no_answer: [],
  voicemail: [],
  declined_ai: [],
  ivr_blocked: [],
  failed: [],
  aborted: [],
};

/**
 * A single call may not exceed this. Bounds the mock's runtime inside the 60s
 * serverless ceiling documented in ARCHITECTURE.md, and in Phase 2 becomes the
 * thing that stops a call sitting on hold from billing indefinitely.
 */
export const MAX_CALL_MS = 45_000;

export class CallError extends Error {
  kind: "not_found" | "illegal_transition" | "already_active" | "not_consented";

  // Written out rather than a constructor parameter property, matching
  // AgentError in domain/entities/errors.ts: Node's strip-only TypeScript
  // execution can erase annotations but not shorthand that also declares a field.
  constructor(
    kind: "not_found" | "illegal_transition" | "already_active" | "not_consented",
    message: string
  ) {
    super(message);
    this.kind = kind;
    this.name = "CallError";
  }
}

export interface CreateSessionInput {
  clinicId: string;
  clinicName: string;
  phone: string;
}

/**
 * One live call per clinic at a time. This is the anti-abuse rail: without it,
 * a page that re-rendered or a user who double-tapped could put several
 * simultaneous automated calls into one clinic's phone line, which is
 * indistinguishable from harassment from the receptionist's side.
 */
export async function activeSessionFor(clinicId: string): Promise<CallSession | undefined> {
  return callSessionStore.findActiveFor(clinicId);
}

export async function createSession(
  input: CreateSessionInput,
  now: () => number = Date.now
): Promise<CallSession> {
  const session: CallSession = {
    id: globalThis.crypto.randomUUID(),
    clinicId: input.clinicId,
    clinicName: input.clinicName,
    phone: input.phone,
    status: "awaiting_consent",
    transcript: [],
    outcome: null,
    createdAt: now(),
    startedAt: null,
    endedAt: null,
  };

  const claimed = await callSessionStore.createIfFree(session);
  if (!claimed) {
    throw new CallError(
      "already_active",
      `A call to ${input.clinicName} is already in progress.`
    );
  }
  return session;
}

export async function getSession(id: string): Promise<CallSession | undefined> {
  return callSessionStore.get(id);
}

export async function requireSession(id: string): Promise<CallSession> {
  const session = await callSessionStore.get(id);
  if (!session) throw new CallError("not_found", "That call could not be found.");
  return session;
}

export async function transition(
  session: CallSession,
  next: CallStatus,
  now: () => number = Date.now
): Promise<CallSession> {
  if (!ALLOWED[session.status].includes(next)) {
    throw new CallError(
      "illegal_transition",
      `Cannot go from ${session.status} to ${next}.`
    );
  }

  session.status = next;
  if (next === "in_progress" && session.startedAt === null) session.startedAt = now();
  if (isTerminal(next) && session.endedAt === null) session.endedAt = now();

  await callSessionStore.save(session);
  return session;
}

export async function appendTurn(session: CallSession, turn: CallTurn): Promise<CallTurn> {
  session.transcript.push(turn);
  await callSessionStore.save(session);
  return turn;
}

export async function recordOutcome(session: CallSession, outcome: CallOutcome): Promise<void> {
  session.outcome = outcome;
  await callSessionStore.save(session);
}

/**
 * Test seam — only actually resets anything when the in-memory store is the
 * one in use, which is always true in tests (they never set
 * UPSTASH_REDIS_REST_URL). Kept synchronous so existing `beforeEach(() =>
 * _resetSessions())` calls don't need to become async.
 */
export function _resetSessions(): void {
  clearInMemorySessions();
}
