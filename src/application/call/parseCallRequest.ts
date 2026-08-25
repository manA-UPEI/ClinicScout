// PersonaId is a demo/testing-only convenience (forces which scripted
// receptionist answers) baked into the mock adapter rather than a domain
// concept — importing its type here (not its implementation) is a narrow,
// deliberate exception to "application depends only on ports", scoped to one
// optional field that only ever matters for local testing.
import type { PersonaId } from "../../infrastructure/call/mockCallProvider.ts";

/**
 * Long enough for the most verbose real OSM `name` tag, short enough that one
 * request cannot pad the call transcript — and through it the extraction
 * prompt in extractFindingsUseCase.ts — with a wall of text.
 */
export const MAX_CLINIC_NAME_LENGTH = 120;

/** E.164 tops out at 15 digits; the rest of the budget is formatting. */
export const MAX_PHONE_LENGTH = 32;

/** Interpolated into a Redis key (`call:active:${clinicId}`), so it stays short. */
export const MAX_CLINIC_ID_LENGTH = 120;

const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

/**
 * Characters that let text forge structure rather than describe a clinic.
 *
 * Deliberately a deny-list here, where `location` in the search route gets a
 * strict allowlist — the two fields have different provenance. A location is
 * typed by a person and lives in a narrow domain, so naming what it may
 * contain is safe. A clinic name arrives from OpenStreetMap's free-form `name`
 * tag by way of the client, and those legitimately carry colons, ampersands,
 * quotes and punctuation from every writing system on earth. An allowlist
 * tight enough to be worth having would reject real clinics and leave the user
 * unable to call them.
 *
 * So this blocks only what a real name never contains and an attacker needs:
 * control characters (a newline is the one ingredient required to forge a
 * `CLINIC:` line in the transcript prompt — see extractFindingsUseCase.ts's
 * `SPEAKER: text` format), angle brackets and pipes (chat-template tokens like
 * <|im_start|>), and braces, brackets, backticks and backslashes (fenced
 * blocks and escape sequences).
 *
 * Worth being clear about the ceiling: transcriptEvidence.ts builds its quote
 * haystack by filtering on `speaker === "clinic"` structurally, not by reading
 * the prompt back, so even a forged line could never have become a verified
 * finding. This closes the gap one layer earlier, where the cost is a rejected
 * request rather than a silently dropped finding.
 */
const STRUCTURAL_CHARS = /[\p{Cc}\p{Cf}<>|`{}\[\]\\]/u;

/** Phone formatting a dialer can strip: digits plus separators, `+` only leading. */
const PHONE_SHAPE = /^\+?[0-9 ().-]+$/;

/**
 * Every PersonaId, as a runtime-checkable set.
 *
 * `satisfies Record<PersonaId, true>` makes this exhaustive at compile time:
 * adding a persona to the union without listing it here is a type error, so
 * the check cannot silently drift out of date the way a hand-copied array of
 * strings would.
 */
const PERSONA_IDS = {
  books_it: true,
  no_walk_ins: true,
  vague_answers: true,
  declines_ai: true,
  voicemail: true,
  ivr_maze: true,
  no_answer: true,
} satisfies Record<PersonaId, true>;

export interface CallRequestBody {
  clinicId?: unknown;
  clinicName?: unknown;
  phone?: unknown;
  /** Must be explicitly true — see the consent check below. */
  consented?: unknown;
  /** Demo/testing only: forces which scripted receptionist answers. */
  persona?: unknown;
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

function invalid(message: string): ParseCallRequestResult {
  return { ok: false, kind: "invalid", message, status: 400 };
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** How many digits a phone value carries once formatting is set aside. */
function digitCount(phone: string): number {
  return (phone.match(/[0-9]/g) ?? []).length;
}

/**
 * Validates a call request's shape and its one business rule — consent must
 * be explicitly true, never assumed — before any session is created. Pure
 * and unit-testable without constructing a Request object.
 *
 * Every field here is client-supplied and none of it is re-checked against
 * the search results that produced it, so each is validated on its own terms:
 * `clinicName` reaches an LLM prompt through the call transcript, `clinicId`
 * becomes part of a Redis key, and `phone` is what a real dialer would
 * eventually be handed.
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

  const clinicId = asTrimmedString(body.clinicId);
  const clinicName = asTrimmedString(body.clinicName);
  const phone = asTrimmedString(body.phone);

  if (!clinicId || !clinicName || !phone) {
    return invalid("Missing clinic details for the call.");
  }

  if (clinicId.length > MAX_CLINIC_ID_LENGTH || STRUCTURAL_CHARS.test(clinicId)) {
    return invalid("That clinic reference isn't valid.");
  }

  if (clinicName.length > MAX_CLINIC_NAME_LENGTH) {
    return invalid(
      `Clinic name is too long — it must be under ${MAX_CLINIC_NAME_LENGTH} characters.`
    );
  }

  if (STRUCTURAL_CHARS.test(clinicName)) {
    return invalid("Clinic name contains characters that aren't allowed.");
  }

  if (phone.length > MAX_PHONE_LENGTH || !PHONE_SHAPE.test(phone)) {
    return invalid(
      "That doesn't look like a phone number. Use digits, and optionally +, spaces, dashes, dots or brackets."
    );
  }

  // Shape alone would accept "((( - )))". A dialer needs actual digits, and
  // this is the check that starts mattering for real the moment Phase 2 swaps
  // the mock provider for live telephony.
  const digits = digitCount(phone);
  if (digits < MIN_PHONE_DIGITS || digits > MAX_PHONE_DIGITS) {
    return invalid(
      `That doesn't look like a phone number — it needs between ${MIN_PHONE_DIGITS} and ${MAX_PHONE_DIGITS} digits.`
    );
  }

  // Absent is fine (the provider picks a persona from the clinic id); present
  // but unrecognised is not, since it would silently index PERSONAS to
  // undefined deep inside the provider rather than fail here.
  // Object.hasOwn rather than `in`, so an inherited name like "toString"
  // cannot pass for a persona.
  if (
    body.persona !== undefined &&
    (typeof body.persona !== "string" || !Object.hasOwn(PERSONA_IDS, body.persona))
  ) {
    return invalid("Unknown persona.");
  }

  const persona = body.persona as PersonaId | undefined;

  return { ok: true, request: { clinicId, clinicName, phone, persona } };
}
