export type Confidence = "High" | "Medium" | "Low";

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface GeocodedLocation extends Coordinates {
  display_name: string;
}

/**
 * How well a listing matches "somewhere I can be seen for a general problem".
 * `unknown` is eligible — we exclude only on positive evidence of a specialty.
 */
export type Relevance = "walk_in" | "general" | "specialty" | "unknown";

export interface ClinicClassification {
  relevance: Relevance;
  /** Human-readable specialty, e.g. "Eye care". Null unless relevance is specialty. */
  specialty: string | null;
}

/** Fields inspect_clinic may recover from a clinic's own website. */
export type InspectableField =
  | "current_capacity"
  | "accepts_walk_ins"
  | "appointment_required"
  | "booking_url"
  | "email"
  | "email_booking_supported"
  | "phone"
  | "opening_hours";

/**
 * A verbatim snippet from the clinic's website backing one extracted field.
 * A claim whose quote cannot be found in the fetched page is discarded, so
 * every surviving field is traceable to text a human can go read.
 */
export interface Evidence {
  field: InspectableField;
  quote: string;
}

/** Result of inspect_clinic. Every field is null unless the page stated it. */
export interface ClinicInspection {
  current_capacity: string | null;
  accepts_walk_ins: boolean | null;
  appointment_required: boolean | null;
  booking_url: string | null;
  email: string | null;
  email_booking_supported: boolean | null;
  phone: string | null;
  /** Hours exactly as displayed on the page — its own evidence quote. */
  opening_hours: string | null;
  /**
   * Best-effort OSM-syntax translation of `opening_hours`. Unlike every other
   * field here, this is not a claim the page states verbatim — it's derived
   * by the model — so it is verified differently: only trusted when
   * `opening_hours` itself is verified AND this string independently parses
   * via `isValidOpeningHours`. See domain/verification/pageEvidence.ts.
   */
  opening_hours_osm: string | null;
  evidence: Evidence[];
}

/** Fully assembled clinic record used for ranking + display. */
export interface Clinic {
  clinic_name: string;
  address: string | null;
  distance_km: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  source_url: string;
  opening_hours: string | null;
  open_now: boolean | null;
  current_capacity: string | null;
  accepts_walk_ins: boolean | null;
  appointment_required: boolean | null;
  booking_url: string | null;
  email_booking_supported: boolean | null;
  confidence: Confidence;
  relevance: Relevance;
  specialty: string | null;
  /** Empty when the clinic's website was never read (no URL, or fetch failed). */
  evidence: Evidence[];
}

/** A specialty listing dropped before ranking, shown so the filter is auditable. */
export interface ExcludedSpecialty {
  clinic_name: string;
  specialty: string;
}

/** Result of rank_clinics: clinics in priority order + the reasoning trail per clinic. */
export interface RankedClinic extends Clinic {
  rank: number;
  rationale: string;
}

/**
 * `https://www.openstreetmap.org/node/123` -> `node/123`.
 *
 * The full source_url is already a stable unique key, but it repeats 30-odd
 * characters of boilerplate per clinic in every tool result the model sees.
 * Moved verbatim from what was lib/agent/state.ts's `shortId` (now
 * application/search/agentState.ts, which re-exports this under the old
 * name), renamed for clarity now
 * that it lives alongside the rest of the Clinic entity.
 */
export function clinicShortId(sourceUrl: string): string {
  const match = sourceUrl.match(/(node|way|relation)\/(\d+)/);
  return match ? `${match[1]}/${match[2]}` : sourceUrl;
}
