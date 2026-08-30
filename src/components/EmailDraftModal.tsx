"use client";

import { useState } from "react";
import { draft_appointment_email } from "@/domain/services/draftAppointmentEmail";

interface Props {
  clinicName: string;
  recipientEmail: string;
  mode: "booking" | "inquiry";
  onClose: () => void;
}

/**
 * Drafts an email and hands it to the user's own mail app to actually send —
 * this app never sends anything itself. That's not a lesser version of
 * "real": a mailto: link is the honest version of this feature, the same way
 * the call-clinic action is a plain tel: link rather than the app placing a
 * call. The only manual step left once it opens is filling in
 * `[Your Name]`, which draftAppointmentEmail.ts leaves as a placeholder on
 * purpose rather than guessing at who's asking.
 */
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
  const [opened, setOpened] = useState(false);

  const mailtoHref = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg animate-scale-in rounded-xl bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/15 p-6 shadow-xl">
        {opened ? (
          <div className="flex animate-fade-in-up flex-col items-center gap-3 py-6 text-center">
            <p className="text-lg font-semibold">
              📤 Opened in your email app
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Add your name and hit send from there. This only handed the
              draft off to your own email app — nothing was sent from here.
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-gray-900 dark:bg-white dark:text-black px-4 py-2 text-sm font-semibold text-white transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
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
              To: {recipientEmail} — review and edit below, then send it
              yourself from your own email app. This app never sends
              anything on its own.
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
              <a
                href={mailtoHref}
                onClick={() => setOpened(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-150 hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98]"
              >
                Open in Email App
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
