import type { ExcludedSpecialty, InspectableField, RankedClinic } from "./clinic.ts";

/** One line in the agent progress transparency log. */
export interface AgentStep {
  id: string;
  message: string;
}

/**
 * The orchestrator's own closing argument for its pick.
 *
 * Advisory narrative only — it is rendered as the agent's reasoning, never as a
 * clinic fact. `cited_fields` is the part with teeth: every field named here was
 * checked against the verified record before the finalization was accepted, so
 * the agent cannot justify a pick with something the clinic never confirmed.
 * See application/search/citationGuard.ts.
 */
export interface AgentReasoning {
  clinic_id: string;
  reason: string;
  cited_fields: InspectableField[];
  /** True when the agent's pick differs from what rank_clinics scored first. */
  overrode_ranking: boolean;
}

/** Which engine produced a result: the Gemini orchestrator, or the fixed pipeline. */
export type RunMode = "agent" | "deterministic";

export type Urgency = "routine" | "urgent" | "emergency_adjacent";

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

export interface InputFormData {
  location: string;
  urgency: Urgency;
  maxRadiusKm: number;
}
