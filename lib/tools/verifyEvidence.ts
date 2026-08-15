import type { ClinicInspection, Evidence, InspectableField } from "../types.ts";
import { isValidOpeningHours } from "../openingHours.ts";

export const INSPECTABLE_FIELDS: InspectableField[] = [
  "current_capacity",
  "accepts_walk_ins",
  "appointment_required",
  "booking_url",
  "email",
  "email_booking_supported",
  "phone",
  "opening_hours",
];

export const EMPTY_INSPECTION: ClinicInspection = {
  current_capacity: null,
  accepts_walk_ins: null,
  appointment_required: null,
  booking_url: null,
  email: null,
  email_booking_supported: null,
  phone: null,
  opening_hours: null,
  opening_hours_osm: null,
  evidence: [],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The model is instructed to cite verbatim, but "instructed" is not
 * "guaranteed". Every quote is checked against the page before its field is
 * trusted, so a fabricated or paraphrased citation drops the field back to
 * null instead of letting an invented fact reach the ranking.
 */
export function verifyAgainstPage(
  raw: Partial<ClinicInspection>,
  pageText: string
): ClinicInspection {
  const haystack = normalize(pageText);
  const supported = new Set<InspectableField>();
  const evidence: Evidence[] = [];

  for (const entry of raw.evidence ?? []) {
    if (!entry?.quote || !INSPECTABLE_FIELDS.includes(entry.field)) continue;
    const value = raw[entry.field];
    // Evidence for a field the model left blank proves nothing.
    if (value === null || value === undefined || value === "") continue;
    if (supported.has(entry.field)) continue;

    const needle = normalize(entry.quote);
    // Snippets this short match incidentally and verify nothing.
    if (needle.length < 4 || !haystack.includes(needle)) continue;

    supported.add(entry.field);
    evidence.push({ field: entry.field, quote: entry.quote.trim() });
  }

  const keep = <K extends InspectableField>(
    field: K,
    value: ClinicInspection[K]
  ): ClinicInspection[K] => (supported.has(field) ? value : null);

  return {
    current_capacity: keep("current_capacity", raw.current_capacity ?? null),
    accepts_walk_ins: keep("accepts_walk_ins", raw.accepts_walk_ins ?? null),
    appointment_required: keep(
      "appointment_required",
      raw.appointment_required ?? null
    ),
    booking_url: keep("booking_url", raw.booking_url ?? null),
    email: keep("email", raw.email ?? null),
    email_booking_supported: keep(
      "email_booking_supported",
      raw.email_booking_supported ?? null
    ),
    phone: keep("phone", raw.phone ?? null),
    opening_hours: keep("opening_hours", raw.opening_hours ?? null),
    // Set by gateOpeningHoursOsm after this returns — never trusted here,
    // since a derived translation can't be verified by a page quote.
    opening_hours_osm: null,
    evidence,
  };
}

/**
 * A model-provided OSM-syntax translation of a clinic's hours is a claim
 * about *its own translation*, not something the page states, so it can't go
 * through quote verification. It earns trust a different way: the raw text it
 * claims to translate must itself be page-verified, and the translation must
 * independently parse as valid OSM opening_hours syntax. Either failing means
 * a silently wrong "open now" instead of an honest "Unknown" — the one
 * outcome this app is built to avoid — so both gates are required.
 */
export function gateOpeningHoursOsm(
  verifiedOpeningHoursText: string | null,
  candidateOsm: string | null | undefined
): string | null {
  if (!verifiedOpeningHoursText || !candidateOsm) return null;
  return isValidOpeningHours(candidateOsm) ? candidateOsm : null;
}
