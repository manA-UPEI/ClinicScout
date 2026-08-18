import { isTerminal } from "../../domain/entities/call.ts";
import type { CallSession } from "../../domain/entities/call.ts";
import type { CallSessionStore } from "../../application/ports/callSessionStore.ts";

/**
 * The in-process CallSessionStore — the fallback createCallSessionStore.ts
 * (./createCallSessionStore.ts) hands back when no Redis is configured. Same
 * pragmatic single-process choice infrastructure/cache/ttlCache.ts makes.
 *
 * `createIfFree` has no `await` between its check and its write, so despite
 * the async signature it runs as one synchronous block — the atomicity a
 * single Node process already gave the old synchronous version for free,
 * preserved deliberately here rather than lost to the async conversion.
 */

/**
 * How long a finished session stays readable. Long enough for the user to
 * read the outcome and for a late-joining stream to catch up; short enough
 * that a long-running dev server does not accumulate transcripts indefinitely.
 */
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map<string, CallSession>();

function sweep(now: number): void {
  for (const [id, session] of sessions) {
    if (session.endedAt !== null && now - session.endedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export const inMemoryCallSessionStore: CallSessionStore = {
  async get(id) {
    return sessions.get(id);
  },

  async findActiveFor(clinicId) {
    for (const session of sessions.values()) {
      if (session.clinicId === clinicId && !isTerminal(session.status)) return session;
    }
    return undefined;
  },

  async createIfFree(session) {
    sweep(Date.now());
    for (const existing of sessions.values()) {
      if (existing.clinicId === session.clinicId && !isTerminal(existing.status)) {
        return false;
      }
    }
    sessions.set(session.id, session);
    return true;
  },

  async save(session) {
    sessions.set(session.id, session);
  },
};

/** Test seam — the store above is a module-level singleton, so a suite needs a way to reset it. */
export function clearInMemorySessions(): void {
  sessions.clear();
}
