import { isTerminal } from "./types.ts";
import type { CallOutcome, CallSession, CallStatus, CallTurn } from "./types.ts";

/**
 * Call lifecycle and the in-process store holding it.
 *
 * The store is a plain Map, the same pragmatic choice infrastructure/cache/ttlCache.ts makes
 * and for the same reason: this app runs as a single long-lived Node process,
 * and a shared store would be scaffolding for a deployment shape it does not
 * have. Phase 2 replaces it, because a real call outlives the request that
 * started it and its state has to survive somewhere the webhook can reach.
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
 * How long a finished session stays readable. Long enough for the user to read
 * the outcome and for a late-joining stream to catch up; short enough that a
 * long-running dev server does not accumulate transcripts indefinitely.
 */
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * A single call may not exceed this. Bounds the mock's runtime inside the 60s
 * serverless ceiling documented in ARCHITECTURE.md, and in Phase 2 becomes the
 * thing that stops a call sitting on hold from billing indefinitely.
 */
export const MAX_CALL_MS = 45_000;

export class CallError extends Error {
  kind: "not_found" | "illegal_transition" | "already_active" | "not_consented";

  // Written out rather than a constructor parameter property, matching
  // AgentError in lib/types.ts: Node's strip-only TypeScript execution can
  // erase annotations but not shorthand that also declares a field.
  constructor(
    kind: "not_found" | "illegal_transition" | "already_active" | "not_consented",
    message: string
  ) {
    super(message);
    this.kind = kind;
    this.name = "CallError";
  }
}

const sessions = new Map<string, CallSession>();

function sweep(now: number): void {
  for (const [id, session] of sessions) {
    const finishedAt = session.endedAt;
    if (finishedAt !== null && now - finishedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
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
  for (const session of sessions.values()) {
    if (session.clinicId === clinicId && !isTerminal(session.status)) return session;
  }
  return undefined;
}

export function createSession(
  input: CreateSessionInput,
  now: () => number = Date.now
): CallSession {
  const at = now();
  sweep(at);

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
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): CallSession | undefined {
  return sessions.get(id);
}

export function requireSession(id: string): CallSession {
  const session = sessions.get(id);
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
  sessions.clear();
}
