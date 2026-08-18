"use client";

import { useRef, useState } from "react";
import { readSseStream } from "@/lib/sseClient";
import { canAgentCall } from "@/lib/tools/actionability";
import { shortId } from "@/lib/agent/state";
import type { Clinic } from "@/domain/entities/clinic";
import type { CallOutcome, CallStatus, CallTurn } from "@/lib/call/types";
import CallConsentModal from "./CallConsentModal";
import CallProgress from "./CallProgress";
import CallOutcomeCard from "./CallOutcomeCard";

interface Props {
  clinic: Clinic;
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
  const abortRef = useRef<AbortController | null>(null);

  if (!canAgentCall(clinic)) return null;

  async function placeCall() {
    setPhase("calling");
    setTurns([]);
    setOutcome(null);
    setError(null);
    setStatus("dialing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          clinicId: shortId(clinic.source_url),
          clinicName: clinic.clinic_name,
          phone: clinic.phone,
          consented: true,
        }),
      });

      if (!response.body || !response.headers.get("Content-Type")?.includes("event-stream")) {
        const payload = (await response.json().catch(() => null)) as
          | { error: { message: string } }
          | null;
        setError(payload?.error?.message ?? "The call could not be placed.");
        setPhase("done");
        return;
      }

      for await (const event of readSseStream(response.body)) {
        if (event.event === "turn") {
          setTurns((prev) => [...prev, (event.data as { turn: CallTurn }).turn]);
        } else if (event.event === "status") {
          setStatus((event.data as { status: CallStatus }).status);
        } else if (event.event === "outcome") {
          setOutcome((event.data as { outcome: CallOutcome }).outcome);
          setPhase("done");
        } else if (event.event === "error") {
          setError((event.data as { message: string }).message);
          setPhase("done");
        }
      }
    } catch {
      // An abort is the user hanging up, which CallProgress already reflects —
      // only a genuine transport failure is worth surfacing as an error.
      if (!controller.signal.aborted) {
        setError("Lost contact with the call.");
      }
      setPhase("done");
    } finally {
      abortRef.current = null;
    }
  }

  function hangUp() {
    abortRef.current?.abort();
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
