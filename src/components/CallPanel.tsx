"use client";

import { useState } from "react";
import { useStreamedSse } from "@/components/hooks/useStreamedSse";
import { canAgentCall } from "@/domain/policies/actionability";
import { clinicShortId } from "@/domain/entities/clinic";
import type { Clinic } from "@/domain/entities/clinic";
import type { CallOutcome, CallStatus, CallTurn } from "@/domain/entities/call";
import CallConsentModal from "./CallConsentModal";
import CallProgress from "./CallProgress";
import CallOutcomeCard from "./CallOutcomeCard";

interface Props {
  clinic: Clinic;
}

/** CallPanel has no structured error component, so a request id is appended inline rather than shown separately. */
function formatError(message: string, requestId?: string): string {
  return requestId ? `${message} (ref: ${requestId})` : message;
}

type Phase = "idle" | "consent" | "calling" | "done";

/**
 * Offers to phone the clinic, and owns the call once the user approves.
 *
 * Sits alongside the primary next action rather than replacing it: the point
 * of the call is to find out whether turning up is worth the trip, which is a
 * question the user still answers themselves afterwards.
 */
export default function CallPanel({ clinic }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<CallStatus>("awaiting_consent");
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, abort } = useStreamedSse();

  if (!canAgentCall(clinic)) return null;

  async function placeCall() {
    setPhase("calling");
    setTurns([]);
    setOutcome(null);
    setError(null);
    setStatus("dialing");

    await run(
      "/api/call",
      {
        clinicId: clinicShortId(clinic.source_url),
        clinicName: clinic.clinic_name,
        phone: clinic.phone,
        consented: true,
      },
      {
        fallbackErrorMessage: "The call could not be placed.",
        networkErrorMessage: "Lost contact with the call.",
        onEvent: (event) => {
          if (event.event === "turn") {
            setTurns((prev) => [...prev, (event.data as { turn: CallTurn }).turn]);
          } else if (event.event === "status") {
            setStatus((event.data as { status: CallStatus }).status);
          } else if (event.event === "outcome") {
            setOutcome((event.data as { outcome: CallOutcome }).outcome);
            setPhase("done");
          } else if (event.event === "error") {
            const data = event.data as { message: string; requestId?: string };
            setError(formatError(data.message, data.requestId));
            setPhase("done");
          }
        },
        onError: (error) => {
          setError(formatError(error.message, error.requestId));
          setPhase("done");
        },
        // An abort is the user hanging up, which CallProgress already
        // reflects — only a genuine transport failure is worth surfacing as
        // an error, but the panel still needs to leave the "calling" phase.
        onAborted: () => setPhase("done"),
      }
    );
  }

  function hangUp() {
    abort();
    setStatus("aborted");
    setPhase("done");
  }

  return (
    <div className="mt-3">
      {phase === "idle" && (
        <button
          onClick={() => setPhase("consent")}
          className="w-full rounded-lg border border-black/15 px-4 py-3 text-center text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          📞 Have the agent call and ask about walk-ins
        </button>
      )}

      {phase === "consent" && (
        <CallConsentModal
          clinicName={clinic.clinic_name}
          phone={clinic.phone!}
          onConfirm={placeCall}
          onCancel={() => setPhase("idle")}
        />
      )}

      {(phase === "calling" || phase === "done") && (
        <div className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15">
          <CallProgress
            clinicName={clinic.clinic_name}
            status={status}
            turns={turns}
            onHangUp={hangUp}
          />

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </p>
          )}

          {outcome && (
            <CallOutcomeCard clinicName={clinic.clinic_name} outcome={outcome} />
          )}

          {phase === "done" && (
            <button
              onClick={() => setPhase("idle")}
              className="self-start text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}
