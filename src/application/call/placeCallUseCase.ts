import { extractFindings } from "./extractFindingsUseCase.ts";
import { appendTurn, MAX_CALL_MS, recordOutcome, transition } from "./callSessionService.ts";
import { buildOutcome } from "../../domain/verification/transcriptEvidence.ts";
import type { CallProvider } from "../ports/callProvider.ts";
import type { CallOutcome, CallSession, CallStatus, CallTurn } from "../../domain/entities/call.ts";

export type CallEvent =
  | { kind: "status"; status: CallStatus }
  | { kind: "turn"; turn: CallTurn }
  | { kind: "outcome"; outcome: CallOutcome };

/**
 * Drives one call from dial to outcome.
 *
 * The ordering here is the safety property: the provider only ever produces
 * *speech*. Turning speech into claimed facts, and claimed facts into
 * confirmed ones, happens after the line is down and is done by code the
 * provider cannot influence. A provider — mock today, a live telephony
 * adapter tomorrow — has no way to hand back a "finding"; it can only hand
 * back words somebody said.
 */
export async function runCall(
  session: CallSession,
  provider: CallProvider,
  onEvent: (event: CallEvent) => void,
  userSignal?: AbortSignal
): Promise<CallOutcome> {
  const emitStatus = async (status: CallStatus) => {
    await transition(session, status);
    onEvent({ kind: "status", status });
  };

  await emitStatus("dialing");

  // The user hanging up and the call running long are the same thing to the
  // provider: stop talking. Combining them here keeps that logic out of every
  // future adapter.
  const timeout = AbortSignal.timeout(MAX_CALL_MS);
  const signal = userSignal
    ? AbortSignal.any([userSignal, timeout])
    : timeout;

  let status: CallStatus;
  try {
    status = await provider.place(
      session,
      async (turn) => {
        // First words heard is what "connected" actually means; a provider
        // that never emits a turn leaves the session in `dialing` and
        // terminates as no_answer.
        if (session.status === "dialing") await emitStatus("in_progress");
        await appendTurn(session, turn);
        onEvent({ kind: "turn", turn });
      },
      signal
    );
  } catch (e) {
    console.error(`Call provider ${provider.name} failed:`, e);
    status = "failed";
  }

  // A user abort outranks whatever the provider was about to report: they
  // stopped listening, so nothing after that point is theirs to act on.
  if (userSignal?.aborted) status = "aborted";

  await emitStatus(status);

  const claims = await extractFindings(session.transcript);
  const outcome = buildOutcome(status, claims, session.transcript);
  await recordOutcome(session, outcome);
  onEvent({ kind: "outcome", outcome });

  return outcome;
}
