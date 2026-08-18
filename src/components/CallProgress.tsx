"use client";

import { CALL_FIELD_LABELS, STATUS_NOTE } from "@/domain/entities/call";
import type { CallStatus, CallTurn } from "@/domain/entities/call";

interface Props {
  clinicName: string;
  status: CallStatus;
  turns: CallTurn[];
  onHangUp: () => void;
}

const LIVE: CallStatus[] = ["dialing", "in_progress"];

/**
 * The call as it happens, turn by turn.
 *
 * Same reasoning as AgentProgress: the pacing is the call's own, so a
 * receptionist who takes four seconds to answer looks like four seconds. The
 * user is accountable for what is said in their name, and the only way that
 * accountability is real is if they can watch it being said and stop it.
 */
export default function CallProgress({
  clinicName,
  status,
  turns,
  onHangUp,
}: Props) {
  const live = LIVE.includes(status);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          {live && <span className="inline-block animate-spin">⟳</span>}
          {status === "dialing" ? `Calling ${clinicName}...` : STATUS_NOTE[status]}
        </p>
        {live && (
          <button
            onClick={onHangUp}
            className="shrink-0 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            Hang up
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {turns.map((turn, i) => (
          <li
            key={`${turn.atMs}-${i}`}
            className={turn.speaker === "agent" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                turn.speaker === "agent"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2 text-sm text-white"
                  : "max-w-[85%] rounded-2xl rounded-bl-sm bg-black/5 px-3.5 py-2 text-sm text-gray-800 dark:bg-white/10 dark:text-gray-100"
              }
            >
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-70">
                {turn.speaker === "agent" ? "Agent" : clinicName}
              </span>
              {turn.text}
            </div>
          </li>
        ))}
      </ul>

      {live && turns.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Ringing — asking about {Object.values(CALL_FIELD_LABELS)[0].toLowerCase()} once
          someone picks up.
        </p>
      )}
    </div>
  );
}
