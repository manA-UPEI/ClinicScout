"use client";

import { useState } from "react";
import { Clinic } from "@/lib/types";
import { determineAction } from "@/lib/determineAction";
import EmailDraftModal from "./EmailDraftModal";

interface Props {
  clinic: Clinic;
}

export default function ActionPanel({ clinic }: Props) {
  const [modalMode, setModalMode] = useState<"booking" | "inquiry" | null>(null);
  const action = determineAction(clinic);

  return (
    <div className="mt-4">
      {action.kind === "book_online" && (
        <a
          href={action.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
        >
          Book Appointment
        </a>
      )}

      {action.kind === "email_verified" && (
        <button
          onClick={() => setModalMode("booking")}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
        >
          Review Email Draft
        </button>
      )}

      {action.kind === "email_unverified" && (
        <div className="flex flex-col gap-2">
          <p className="rounded-lg bg-yellow-50 dark:bg-yellow-900/30 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300">
            An email is available, but we cannot verify they accept bookings
            this way.
          </p>
          <button
            onClick={() => setModalMode("inquiry")}
            className="w-full rounded-lg border border-black/15 dark:border-white/20 px-4 py-3 text-center text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10"
          >
            Draft General Inquiry
          </button>
        </div>
      )}

      {action.kind === "call_only" && (
        <a
          href={`tel:${action.phone}`}
          className="block w-full rounded-lg bg-green-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-green-700"
        >
          Call Clinic: {action.phone}
        </a>
      )}

      {action.kind === "no_contact_available" && (
        <p className="rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-3 text-center text-sm text-gray-500 dark:text-gray-400">
          No contact information available.
        </p>
      )}

      {modalMode && (action.kind === "email_verified" || action.kind === "email_unverified") && (
        <EmailDraftModal
          clinicName={clinic.clinic_name}
          recipientEmail={action.email}
          mode={modalMode}
          onClose={() => setModalMode(null)}
        />
      )}
    </div>
  );
}
