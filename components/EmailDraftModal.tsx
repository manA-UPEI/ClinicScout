"use client";

import { useState } from "react";
import { draft_appointment_email } from "@/lib/tools/draftAppointmentEmail";

interface Props {
  clinicName: string;
  recipientEmail: string;
  mode: "booking" | "inquiry";
  onClose: () => void;
}

export default function EmailDraftModal({
  clinicName,
  recipientEmail,
  mode,
  onClose,
}: Props) {
  const draft = draft_appointment_email(
    clinicName,
    "",
    mode === "booking"
      ? "I'm hoping to be seen as a walk-in or at the earliest available slot."
      : "I'm inquiring whether you accept appointment requests by email, and if so, how to book one."
  );

  const [subject, setSubject] = useState(draft.subject_line);
  const [body, setBody] = useState(draft.email_body);
  const [sent, setSent] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/15 p-6 shadow-xl">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-lg font-semibold">
              ✅ Email marked as sent (mock — no real email was sent)
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              To: {recipientEmail}
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-gray-900 dark:bg-white dark:text-black px-4 py-2 text-sm font-semibold text-white"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold">
              {mode === "booking" ? "Review appointment request" : "Review general inquiry"}
            </h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              To: {recipientEmail} — review and edit before sending. Nothing is
              sent until you approve.
            </p>

            <label className="flex flex-col gap-1 text-sm font-medium">
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
              Message
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={7}
                className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => setSent(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Approve & Send (Mock)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
