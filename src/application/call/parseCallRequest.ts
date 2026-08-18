// PersonaId is a demo/testing-only convenience (forces which scripted
// receptionist answers) baked into the mock adapter rather than a domain
// concept — importing its type here (not its implementation) is a narrow,
// deliberate exception to "application depends only on ports", scoped to one
// optional field that only ever matters for local testing.
import type { PersonaId } from "../../infrastructure/call/mockCallProvider.ts";

export interface CallRequestBody {
  clinicId?: string;
  clinicName?: string;
  phone?: string;
  /** Must be explicitly true — see the consent check below. */
  consented?: boolean;
  /** Demo/testing only: forces which scripted receptionist answers. */
  persona?: PersonaId;
}

export interface PlaceCallRequest {
  clinicId: string;
  clinicName: string;
  phone: string;
  persona?: PersonaId;
}

export type ParseCallRequestResult =
  | { ok: true; request: PlaceCallRequest }
  | { ok: false; kind: string; message: string; status: number };

/**
 * Validates a call request's shape and its one business rule — consent must
 * be explicitly true, never assumed — before any session is created. Pure
 * and unit-testable without constructing a Request object.
 */
export function parseCallRequest(body: CallRequestBody | null): ParseCallRequestResult {
  // Consent is a required field rather than an assumed default. Placing an
  // automated call is not something to fall into because a flag was missing.
  if (body?.consented !== true) {
    return {
      ok: false,
      kind: "not_consented",
      message: "A call can only be placed after you approve the script.",
      status: 400,
    };
  }

  const clinicName = body.clinicName?.trim();
  const phone = body.phone?.trim();
  const clinicId = body.clinicId?.trim();

  if (!clinicId || !clinicName || !phone) {
    return { ok: false, kind: "invalid", message: "Missing clinic details for the call.", status: 400 };
  }

  return { ok: true, request: { clinicId, clinicName, phone, persona: body.persona } };
}
