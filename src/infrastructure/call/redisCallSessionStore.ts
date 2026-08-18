import { isTerminal } from "../../domain/entities/call.ts";
import type { CallSession } from "../../domain/entities/call.ts";
import type { CallSessionStore } from "../../application/ports/callSessionStore.ts";
import type { RedisTransport } from "../cache/redisRestClient.ts";

// How long a session record stays readable in Redis, refreshed on every
// write. Matches inMemoryCallSessionStore's SESSION_TTL_MS: long enough to
// read a finished call's outcome, short enough not to accumulate forever.
const SESSION_TTL_SECONDS = 30 * 60;

// The active-clinic claim's own, much shorter TTL — a safety net, not the
// normal cleanup path. save() clears the claim the moment a call reaches a
// terminal status; this backstop only matters if a process dies mid-call and
// never gets the chance to, which would otherwise lock a clinic out of any
// new call until this expires. Sized to MAX_CALL_MS (45s,
// application/call/callSessionService.ts) plus margin.
const ACTIVE_CLAIM_TTL_SECONDS = 120;

function sessionKey(id: string): string {
  return `call:session:${id}`;
}

function activeKey(clinicId: string): string {
  return `call:active:${clinicId}`;
}

/**
 * A CallSessionStore backed by Redis instead of process memory, so the
 * one-call-per-clinic rule and a session's live transcript hold across
 * serverless instances and cold starts.
 *
 * The one-call-per-clinic guarantee rides entirely on `createIfFree`'s
 * SET-NX: two concurrent createSession calls for the same clinic — even from
 * two different instances — can't both win the claim, which a separate
 * findActiveFor-then-write couldn't promise. `save` releases the claim the
 * moment a session goes terminal; ACTIVE_CLAIM_TTL_SECONDS is only the
 * backstop for a process that dies before it gets the chance to.
 */
export function createRedisCallSessionStore(transport: RedisTransport): CallSessionStore {
  async function getSession(id: string): Promise<CallSession | undefined> {
    const raw = await transport.get(sessionKey(id));
    return raw ? (JSON.parse(raw) as CallSession) : undefined;
  }

  async function writeSession(session: CallSession): Promise<void> {
    await transport.set(sessionKey(session.id), JSON.stringify(session), SESSION_TTL_SECONDS);
  }

  return {
    get: getSession,

    async findActiveFor(clinicId) {
      const id = await transport.get(activeKey(clinicId));
      if (!id) return undefined;
      const session = await getSession(id);
      return session && !isTerminal(session.status) ? session : undefined;
    },

    async createIfFree(session) {
      const claimed = await transport.setnx(
        activeKey(session.clinicId),
        session.id,
        ACTIVE_CLAIM_TTL_SECONDS
      );
      if (!claimed) return false;

      await writeSession(session);
      return true;
    },

    async save(session) {
      await writeSession(session);
      if (isTerminal(session.status)) {
        await transport.del(activeKey(session.clinicId));
      }
    },
  };
}
