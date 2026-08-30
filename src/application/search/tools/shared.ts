import type { AgentStep } from "../../../domain/entities/agentRun.ts";
import type { Clinic } from "../../../domain/entities/clinic.ts";
import type { FunctionDeclaration } from "../../../infrastructure/llm/geminiFunctionCallClient.ts";
import type { RunState } from "../agentState.ts";

export interface ToolOutcome {
  /** Sent back to the model as the functionResponse payload. */
  response: Record<string, unknown>;
  /** Appended to the transparency log and streamed to the UI. */
  step?: AgentStep;
  /** Set by finalize_recommendation to end the loop. */
  done?: boolean;
}

export type ToolExecutor = (
  state: RunState,
  args: Record<string, unknown>
) => Promise<ToolOutcome>;

export interface AgentTool {
  declaration: FunctionDeclaration;
  execute: ToolExecutor;
}

/** Shorthand for a tool rejecting its arguments — becomes a functionResponse error, not a thrown exception. */
export function fail(message: string): ToolOutcome {
  return { response: { error: message } };
}

/** Coerces a model-supplied value into a deduped, capped list of string ids. */
export function asIdList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === "string");
  return [...new Set(ids)].slice(0, cap);
}

/**
 * The full confirmed-detail shape for one clinic — what `get_clinic_details`
 * returns, and what `inspect_clinic_websites` now also returns for whatever
 * it just inspected, so checking details for a clinic that was just read
 * usually doesn't need a separate call. One implementation, two call sites.
 */
export function buildClinicDetail(id: string, clinic: Clinic) {
  return {
    id,
    name: clinic.clinic_name,
    distance_km: clinic.distance_km,
    open_now: clinic.open_now,
    opening_hours: clinic.opening_hours,
    current_capacity: clinic.current_capacity,
    accepts_walk_ins: clinic.accepts_walk_ins,
    appointment_required: clinic.appointment_required,
    relevance: clinic.relevance,
    confidence: clinic.confidence,
    // Contact details are reported as presence, not value: whether the user
    // can be routed to a next action is the judgment call, and the literal
    // phone number or address adds nothing to it.
    has_booking_url: Boolean(clinic.booking_url),
    has_email: Boolean(clinic.email),
    email_booking_supported: clinic.email_booking_supported,
    has_phone: Boolean(clinic.phone),
    has_address: Boolean(clinic.address),
    page_verified_evidence: clinic.evidence.map((e) => ({
      field: e.field,
      quote: e.quote,
    })),
  };
}
