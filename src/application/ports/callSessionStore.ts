import type { CallSession } from "../../domain/entities/call.ts";

/**
 * Storage primitives only. Which transitions are legal, and the one-live-
 * call-per-clinic rule's meaning, are business rules that live in
 * application/call/callSessionService.ts — this port only has to store a
 * session and answer "is there already a live one for this clinic".
 *
 * In-memory today (infrastructure/call/inMemoryCallSessionStore.ts) and
 * Redis-backed when configured (infrastructure/call/redisCallSessionStore.ts),
 * chosen by infrastructure/call/createCallSessionStore.ts. Redis is what
 * makes the one-call-per-clinic guarantee — and a session's live transcript —
 * hold across serverless instances instead of just within one warm process.
 */
export interface CallSessionStore {
  get(id: string): Promise<CallSession | undefined>;

  /** The one non-terminal session for this clinic, if any. */
  findActiveFor(clinicId: string): Promise<CallSession | undefined>;

  /**
   * Atomically stores `session` only if no non-terminal session already
   * exists for its clinicId, and reports whether the claim succeeded. The
   * primitive the one-call-per-clinic rule is built on: a separate
   * findActiveFor-then-put could race two concurrent creates for the same
   * clinic across instances; this can't.
   */
  createIfFree(session: CallSession): Promise<boolean>;

  /** Persists an existing session's current state — status, transcript, or outcome. */
  save(session: CallSession): Promise<void>;
}
