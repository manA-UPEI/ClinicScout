"use client";

import { buildScript, DISCLOSURE } from "@/domain/services/callScript";

interface Props {
  clinicName: string;
  phone: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Approval gate before the agent phones anyone.
 *
 * Follows EmailDraftModal's review-then-approve shape, but shows more than a
 * draft: the user sees every line the agent can say, because a call is spoken
 * on their behalf to a stranger and "roughly what it will ask" is not good
 * enough. The script is rendered from the same buildScript() the call itself
 * runs, so this cannot drift out of sync with what actually gets said.
 */
export default function CallConsentModal({
  clinicName,
  phone,
  onConfirm,
  onCancel,
}: Props) {
  // Index 0 is always the disclosure; it is shown separately above because it
  // is the part that is not up for negotiation.
  const questions = buildScript(clinicName).slice(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/15 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">
          Have the agent call {clinicName}?
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          It will ask about walk-in availability and hang up. It cannot book an
          appointment.
        </p>

        <div className="mt-4 rounded-lg border border-blue-500/25 bg-blue-500/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            It opens by identifying itself
          </p>
          <p className="mt-1.5 text-sm italic text-gray-700 dark:text-gray-200">
            &ldquo;{DISCLOSURE}&rdquo;
          </p>
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Then it asks
        </p>
        <ul className="mt-2 space-y-1.5 border-l-2 border-black/10 pl-3 dark:border-white/15">
          {questions.map((line) => (
            <li key={line.id} className="text-sm text-gray-600 dark:text-gray-300">
              &ldquo;{line.text}&rdquo;
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-900 dark:bg-green-900/25 dark:text-green-200">
          <span className="font-semibold">Nothing about you is shared.</span> No
          name, no number, no symptoms — the agent only asks questions, so the
          clinic learns nothing about you.
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Calling {phone}. This is a simulated call for now — no real phone line
          is used, and nothing is dialled.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Approve &amp; place call
          </button>
        </div>
      </div>
    </div>
  );
}
