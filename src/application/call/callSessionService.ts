import { isTerminal } from "../../domain/entities/call.ts";
import type { CallOutcome, CallSession, CallStatus, CallTurn } from "../../domain/entities/call.ts";
import * as store from "../../infrastructure/call/inMemoryCallSessionStore.ts";

/**
 * The call lifecycle rules. Storage itself lives behind
 * infrastructure/call/inMemoryCallSessionStore.ts; what is enforced here is
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
export function activeSessionFor(clinicId: string): CallSession | undefined {
  return store.findActiveFor(clinicId);
}

export function createSession(
  input: CreateSessionInput,
  now: () => number = Date.now
): CallSession {
  const at = now();
  store.sweep(at);

  const existing = activeSessionFor(input.clinicId);
  if (existing) {
    throw new CallError(
      "already_active",
      `A call to ${input.clinicName} is already in progress.`
    );
  }

  const session: CallSession = {
    id: globalThis.crypto.randomUUID(),
    clinicId: input.clinicId,
    clinicName: input.clinicName,
    phone: input.phone,
    status: "awaiting_consent",
    transcript: [],
    outcome: null,
    createdAt: at,
    startedAt: null,
    endedAt: null,
  };
  store.put(session);
  return session;
}

export function getSession(id: string): CallSession | undefined {
  return store.get(id);
}

export function requireSession(id: string): CallSession {
  const session = store.get(id);
  if (!session) throw new CallError("not_found", "That call could not be found.");
  return session;
}

export function transition(
  session: CallSession,
  next: CallStatus,
  now: () => number = Date.now
): CallSession {
  if (!ALLOWED[session.status].includes(next)) {
    throw new CallError(
      "illegal_transition",
      `Cannot go from ${session.status} to ${next}.`
    );
  }

  session.status = next;
  if (next === "in_progress" && session.startedAt === null) session.startedAt = now();
  if (isTerminal(next) && session.endedAt === null) session.endedAt = now();
  return session;
}

export function appendTurn(session: CallSession, turn: CallTurn): CallTurn {
  session.transcript.push(turn);
  return turn;
}

export function recordOutcome(session: CallSession, outcome: CallOutcome): void {
  session.outcome = outcome;
}

/** Test seam — the store is module-level, so a suite needs a way to reset it. */
export function _resetSessions(): void {
  store.clear();
}
