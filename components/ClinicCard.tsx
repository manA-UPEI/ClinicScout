import { ReactNode } from "react";
import { InspectableField, RankedClinic, Relevance } from "@/lib/types";
import { isDeadEnd } from "@/lib/tools/actionability";
import FieldValue from "./FieldValue";

interface Props {
  clinic: RankedClinic;
  variant: "best" | "alternative";
}

// Only positive classifications are worth a badge; "unknown" would just be
// noise on the majority of listings that OSM leaves uncategorised.
const RELEVANCE_LABEL: Record<Relevance, string | null> = {
  walk_in: "Walk-in clinic",
  general: "General practice",
  specialty: null,
  unknown: null,
};

const CONFIDENCE_STYLES: Record<string, string> = {
  High: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  Medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  Low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export default function ClinicCard({ clinic, variant }: Props) {
  const isBest = variant === "best";
  const verified = new Set(clinic.evidence.map((e) => e.field));

  return (
    <div
      className={
        isBest
          ? "rounded-xl border-2 border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 p-6"
          : "rounded-xl border border-black/10 dark:border-white/15 p-5"
      }
    >
      {isBest && (
        <div className="mb-2 text-sm font-bold text-blue-600 dark:text-blue-400">
          🏆 BEST OPTION
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <h3 className={isBest ? "text-lg font-semibold" : "text-base font-semibold"}>
          {clinic.clinic_name}
        </h3>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {isDeadEnd(clinic) && (
            <span
              className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              title="No address, phone, or email is listed for this clinic"
            >
              No way to reach
            </span>
          )}
          {RELEVANCE_LABEL[clinic.relevance] && (
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
              {RELEVANCE_LABEL[clinic.relevance]}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CONFIDENCE_STYLES[clinic.confidence]}`}
          >
            {clinic.confidence} confidence
          </span>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        <FieldValue kind="text" value={clinic.address} />
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <Row label="Status">
          <FieldValue
            kind="boolean"
            value={clinic.open_now}
            trueLabel="Open now"
            falseLabel="Closed"
          />
        </Row>
        <Row label="Distance">
          <FieldValue kind="number" value={clinic.distance_km} unit=" km" />
        </Row>
        <Row label="Hours" verified={verified.has("opening_hours")}>
          <FieldValue kind="text" value={clinic.opening_hours} />
        </Row>
        <Row label="Capacity" verified={verified.has("current_capacity")}>
          <FieldValue kind="text" value={clinic.current_capacity} />
        </Row>
        <Row label="Walk-ins" verified={verified.has("accepts_walk_ins")}>
          <FieldValue
            kind="boolean"
            value={clinic.accepts_walk_ins}
            trueLabel="Confirmed ✅"
            falseLabel="Not accepted"
          />
        </Row>
        <Row label="Appointment required" verified={verified.has("appointment_required")}>
          <FieldValue
            kind="boolean"
            value={clinic.appointment_required}
            trueLabel="Yes"
            falseLabel="No"
          />
        </Row>
        <Row label="Phone" verified={verified.has("phone")}>
          <FieldValue kind="text" value={clinic.phone} />
        </Row>
        <Row label="Website">
          {clinic.website ? (
            <a
              href={clinic.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline break-all"
            >
              Visit site
            </a>
          ) : (
            <FieldValue kind="text" value={null} />
          )}
        </Row>
      </dl>

      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
        <span className="font-medium">Agent rationale: </span>
        {clinic.rationale}
      </p>

      {clinic.evidence.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-gray-600 dark:text-gray-300">
            Evidence from clinic website ({clinic.evidence.length})
          </summary>
          <ul className="mt-2 space-y-2 border-l-2 border-black/10 dark:border-white/15 pl-3">
            {clinic.evidence.map((e) => (
              <li key={e.field}>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {LABELS[e.field]}
                </span>
                <p className="italic text-gray-600 dark:text-gray-300">
                  &ldquo;{e.quote}&rdquo;
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <a
        href={clinic.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-xs text-gray-400 dark:text-gray-500 hover:underline"
      >
        View data source
      </a>
    </div>
  );
}

const LABELS: Record<InspectableField, string> = {
  current_capacity: "Capacity",
  accepts_walk_ins: "Walk-ins",
  appointment_required: "Appointment required",
  booking_url: "Online booking",
  email: "Email",
  email_booking_supported: "Booking by email",
  phone: "Phone",
  opening_hours: "Hours",
};

function Row({
  label,
  verified,
  children,
}: {
  label: string;
  verified?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-gray-400 dark:text-gray-500">
        {label}
        {verified && (
          <span
            className="ml-1 text-green-600 dark:text-green-400"
            title="Quoted from the clinic's own website"
          >
            ✓
          </span>
        )}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
