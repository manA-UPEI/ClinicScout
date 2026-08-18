import type { CallOutcome, CallSession, CallStatus, CallTurn } from "../../domain/entities/call.ts";

export interface CreateSessionInput {
  clinicId: string;
  clinicName: string;
  phone: string;
}

/** The call-session lifecycle store. In-memory today; a durable, webhook-reachable store in Phase 2 live telephony. */
export interface CallSessionStore {
  /** Throws CallError("already_active") if a live call to this clinic already exists. */
  create(input: CreateSessionInput): CallSession;
  get(id: string): CallSession | undefined;
  /** Throws CallError("not_found"). */
  require(id: string): CallSession;
  activeSessionFor(clinicId: string): CallSession | undefined;
  /** Throws CallError("illegal_transition") for anything not in the allowed-transitions table. */
  transition(session: CallSession, next: CallStatus): CallSession;
  appendTurn(session: CallSession, turn: CallTurn): CallTurn;
  recordOutcome(session: CallSession, outcome: CallOutcome): void;
}
