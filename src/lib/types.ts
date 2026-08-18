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
   * via `isValidOpeningHours`. See lib/tools/verifyEvidence.ts.
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

/** One line in the agent progress transparency log. */
export interface AgentStep {
  id: string;
  message: string;
}

/** A specialty listing dropped before ranking, shown so the filter is auditable. */
export interface ExcludedSpecialty {
  clinic_name: string;
  specialty: string;
}

/**
 * The orchestrator's own closing argument for its pick.
 *
 * Advisory narrative only — it is rendered as the agent's reasoning, never as a
 * clinic fact. `cited_fields` is the part with teeth: every field named here was
 * checked against the verified record before the finalization was accepted, so
 * the agent cannot justify a pick with something the clinic never confirmed.
 * See lib/agent/guards.ts.
 */
export interface AgentReasoning {
  clinic_id: string;
  reason: string;
  cited_fields: InspectableField[];
  /** True when the agent's pick differs from what rank_clinics scored first. */
  overrode_ranking: boolean;
}

/** Result of rank_clinics: clinics in priority order + the reasoning trail per clinic. */
export interface RankedClinic extends Clinic {
  rank: number;
  rationale: string;
}

/** Which engine produced a result: the Gemini orchestrator, or the fixed pipeline. */
export type RunMode = "agent" | "deterministic";

export interface AgentRunResult {
  steps: AgentStep[];
  ranked: RankedClinic[];
  resolvedLocation: string;
  urgency: Urgency;
  excluded: ExcludedSpecialty[];
  mode: RunMode;
  /** Null whenever the deterministic pipeline answered. */
  agentReasoning: AgentReasoning | null;
}

/** Which next-action case applies, per the routing logic. */
export type ActionCase =
  | { kind: "book_online"; bookingUrl: string }
  | { kind: "email_verified"; email: string }
  | { kind: "email_unverified"; email: string }
  | { kind: "call_only"; phone: string }
  | { kind: "no_contact_available" };

export interface DraftedEmail {
  subject_line: string;
  email_body: string;
}

export type Urgency = "routine" | "urgent" | "emergency_adjacent";

export interface InputFormData {
  location: string;
  urgency: Urgency;
  maxRadiusKm: number;
}

export type AgentErrorKind = "location_not_found" | "network" | "no_results";

export class AgentError extends Error {
  kind: AgentErrorKind;

  // Written out instead of a constructor parameter property: Node's
  // strip-only TypeScript execution (used by the raw `node --test` runner)
  // can erase type annotations but not this shorthand, since it also
  // declares a field — this module now loads as a value import, not just
  // types, from lib/tools/geocode.ts.
  constructor(kind: AgentErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "AgentError";
  }
}
