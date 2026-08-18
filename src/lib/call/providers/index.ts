import type { CallSession, CallStatus, CallTurn } from "../types.ts";

/**
 * How a call actually gets placed.
 *
 * The shape is chosen for what live telephony needs rather than for what the
 * mock needs, so Phase 2 is an adapter and not a redesign:
 *
 * - `onTurn` is a callback rather than a return value, because a real call
 *   produces speech over minutes and the UI has to show it as it happens.
 * - `signal` exists because the user must be able to hang up mid-call, and
 *   because a call that sits on hold has to be cut off by a duration cap.
 * - the promise resolves with a terminal status rather than throwing, because
 *   "nobody answered" is an ordinary outcome, not an error.
 *
 * A Twilio + Gemini Live adapter fits this: Twilio Media Streams pushes audio
 * over a WebSocket, Gemini Live returns transcribed turns, each one calls
 * `onTurn`, and hangup resolves the promise.
 */
export interface CallProvider {
  readonly name: string;
  place(
    session: CallSession,
    onTurn: (turn: CallTurn) => void,
    signal: AbortSignal
  ): Promise<CallStatus>;
}

/**
 * Only the mock exists today, and that is deliberate rather than unfinished:
 * placing real automated calls to medical clinics needs a verified caller ID,
 * a number allowlist, and per-jurisdiction disclosure review before it should
 * dial anything. Phase 2 adds `twilio.ts` here behind an explicit flag.
 */
export { mockProvider } from "./mock.ts";
