import { isTerminal } from "../../domain/entities/call.ts";
import type { CallSession } from "../../domain/entities/call.ts";

/**
 * The in-process session store.
 *
 * A plain Map, the same pragmatic choice infrastructure/cache/ttlCache.ts
 * makes and for the same reason: this app runs as a single long-lived Node
 * process, and a shared store would be scaffolding for a deployment shape it
 * does not have. Phase 2 replaces this adapter, because a real call outlives
 * the request that started it and its state has to survive somewhere the
 * provider's webhook can reach.
 *
 * Only storage lives here. Which transitions are legal, and the one-live-call
 * -per-clinic rule, are business rules and live in
 * application/call/callSessionService.ts.
 */

/**
 * How long a finished session stays readable. Long enough for the user to read
 * the outcome and for a late-joining stream to catch up; short enough that a
 * long-running dev server does not accumulate transcripts indefinitely.
 */
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map<string, CallSession>();

/** Drops finished sessions past their TTL. Called on write, so the map cannot grow unboundedly. */
export function sweep(now: number): void {
  for (const [id, session] of sessions) {
    const finishedAt = session.endedAt;
    if (finishedAt !== null && now - finishedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export function put(session: CallSession): void {
  sessions.set(session.id, session);
}

export function get(id: string): CallSession | undefined {
  return sessions.get(id);
}

/** The first non-terminal session for this clinic, if one exists. */
export function findActiveFor(clinicId: string): CallSession | undefined {
  for (const session of sessions.values()) {
    if (session.clinicId === clinicId && !isTerminal(session.status)) return session;
  }
  return undefined;
}

/** Test seam — the store is module-level, so a suite needs a way to reset it. */
export function clear(): void {
  sessions.clear();
}
