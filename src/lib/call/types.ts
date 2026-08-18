/**
 * A call the agent places to a clinic on the user's behalf.
 *
 * This phase is inquire-only: the agent asks whether the clinic is taking
 * walk-ins right now, hangs up, and reports what it heard. There is
 * deliberately no code path by which a call commits to an appointment, so a
 * wrong turn on a call cannot reserve a real slot in a real waiting room.
 *
 * It is also simulated — see lib/call/providers/mock.ts. Everything above the
 * provider boundary (consent, state machine, transcript, verification) is real,
 * which is what makes swapping in live telephony an adapter rather than a
 * rewrite.
 */

export type CallStatus =
  | "awaiting_consent"
  | "dialing"
  | "in_progress"
  /** Reached a human, asked, got an answer of some kind. */
  | "completed"
  | "no_answer"
  | "voicemail"
  /** The answerer declined to speak with an automated caller. */
  | "declined_ai"
  /** An automated menu we cannot navigate. */
  | "ivr_blocked"
  | "failed"
  /** The user hung up mid-call. */
  | "aborted";

/**
 * One utterance. `speaker` is load-bearing rather than cosmetic: verification
 * builds its haystack from clinic turns only, so the agent cannot quote itself
 * into a fact. See domain/verification/transcriptEvidence.ts.
 */
export interface CallTurn {
  speaker: "agent" | "clinic";
  text: string;
  /** Milliseconds since the call connected, so the UI can pace the replay. */
  atMs: number;
}

/** What this phase is allowed to learn from a call. */
export type CallField =
  | "accepts_walk_ins_today"
  | "current_wait"
  | "next_available"
  | "booking_instructions";

/**
 * A fact the extractor claims the clinic stated, with the words it claims
 * state it. Unverified until the quote is matched against the clinic's turns.
 */
export interface ClaimedFinding {
  field: CallField;
  value: string;
  quote: string;
}

/** A claim that survived verification. */
export interface CallFinding extends ClaimedFinding {
  /** Index into the transcript of the clinic turn carrying the quote. */
  turnIndex: number;
}

export interface CallOutcome {
  status: CallStatus;
  findings: CallFinding[];
  /**
   * Fields the extractor claimed but could not back with a clinic quote.
   * Surfaced rather than silently dropped, because "we asked and could not
   * confirm" is different information from "we never asked".
   */
  rejected: CallField[];
}

export interface CallSession {
  id: string;
  /** shortId form (`node/123`), matching lib/agent/state.ts. */
  clinicId: string;
  clinicName: string;
  phone: string;
  status: CallStatus;
  transcript: CallTurn[];
  outcome: CallOutcome | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

/** Human-readable labels for the four fields, shared by UI and step messages. */
export const CALL_FIELD_LABELS: Record<CallField, string> = {
  accepts_walk_ins_today: "Taking walk-ins today",
  current_wait: "Current wait",
  next_available: "Next available",
  booking_instructions: "How to book",
};

/** No further transition is legal from these. */
export const TERMINAL_STATUSES: readonly CallStatus[] = [
  "completed",
  "no_answer",
  "voicemail",
  "declined_ai",
  "ivr_blocked",
  "failed",
  "aborted",
];

export function isTerminal(status: CallStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Why a call ended, phrased for the user. A call that reached nobody is not a
 * failure of the clinic and should not read like one.
 */
export const STATUS_NOTE: Record<CallStatus, string> = {
  awaiting_consent: "Waiting for you to approve the call.",
  dialing: "Dialing the clinic...",
  in_progress: "Connected — asking about walk-in availability.",
  completed: "Call finished.",
  no_answer: "Nobody picked up. The clinic may be closed or busy.",
  voicemail: "Reached voicemail — no one was available to ask.",
  declined_ai:
    "The clinic asked not to be handled by an automated caller, so the call ended there. Please call them yourself.",
  ivr_blocked:
    "The clinic uses an automated menu the agent could not navigate. You'll need to call them directly.",
  failed: "The call could not be completed.",
  aborted: "You ended the call.",
};
