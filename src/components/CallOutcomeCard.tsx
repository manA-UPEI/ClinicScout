"use client";

import { CALL_FIELD_LABELS, STATUS_NOTE } from "@/domain/entities/call";
import type { CallOutcome } from "@/domain/entities/call";
import FieldValue from "./FieldValue";

interface Props {
  clinicName: string;
  outcome: CallOutcome;
}

/**
 * What the call actually established.
 *
 * Every value here quotes something the clinic said — findings that could not
 * be traced to the other party's own words never reach this component, they
 * arrive as `rejected` and render as Unknown. That is the same distinction
 * ClinicCard draws between a website-verified field and an OSM tag, applied to
 * speech: a ✓ means someone said it, not that the agent believes it.
 */
export default function CallOutcomeCard({ clinicName, outcome }: Props) {
  const nothingLearned =
    outcome.findings.length === 0 && outcome.rejected.length === 0;

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
      <p className="text-sm font-medium">{STATUS_NOTE[outcome.status]}</p>

      {outcome.findings.length > 0 && (
        <dl className="mt-3 flex flex-col gap-2.5">
          {outcome.findings.map((f) => (
            <div key={f.field}>
              <dt className="text-xs text-gray-400 dark:text-gray-500">
                {CALL_FIELD_LABELS[f.field]}
                <span
                  className="ml-1 text-green-600 dark:text-green-400"
                  title={`Quoted from what ${clinicName} said on the call`}
                >
                  ✓
                </span>
              </dt>
              <dd className="text-sm font-medium">{f.value}</dd>
              <p className="mt-0.5 border-l-2 border-black/10 pl-2 text-xs italic text-gray-500 dark:border-white/15 dark:text-gray-400">
                &ldquo;{f.quote}&rdquo;
              </p>
            </div>
          ))}
        </dl>
      )}

      {outcome.rejected.length > 0 && (
        <dl className="mt-3 flex flex-col gap-1.5">
          {outcome.rejected.map((field) => (
            <div key={field} className="flex flex-col">
              <dt className="text-xs text-gray-400 dark:text-gray-500">
                {CALL_FIELD_LABELS[field]}
              </dt>
              <dd className="text-sm">
                <FieldValue kind="text" value={null} />
              </dd>
            </div>
          ))}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            The agent asked, but nothing it heard confirmed these — so they stay
            Unknown rather than being guessed at.
          </p>
        </dl>
      )}

      {nothingLearned && outcome.status === "completed" && (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          The call connected, but nothing said on it confirmed anything about
          walk-in availability. Worth calling {clinicName} yourself.
        </p>
      )}
    </div>
  );
}
