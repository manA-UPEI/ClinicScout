import type { InputFormData, Urgency } from "../../domain/entities/agentRun.ts";

const URGENCIES: readonly Urgency[] = ["routine", "urgent", "emergency_adjacent"];

// No real place name or address needs more than this. Also caps how much
// arbitrary text a request can smuggle into the Gemini agent's opening
// prompt, where `location` is interpolated verbatim (see
// runGeminiAgentUseCase.ts's openingMessage) — an unbounded field would let
// one request carry a wall of injected instructions at negligible cost.
export const MAX_LOCATION_LENGTH = 200;

const MIN_RADIUS_KM = 0.5;
const MAX_RADIUS_KM = 50;

/**
 * What one character of a place name or address may be — an allowlist, so a
 * character is rejected unless it has a reason to be here, rather than only
 * when someone thought to ban it.
 *
 * Unicode-aware on purpose. This app geocodes against OpenStreetMap, which is
 * global, so `\p{L}` (any letter) and `\p{M}` (combining accent marks) are
 * requirements, not generosity: an ASCII-only list would reject Montréal,
 * Zürich, São Paulo and 東京 outright.
 *
 * `\p{Nd}` is decimal digits only — street and postal numbers — rather than
 * `\p{N}`, which would also admit oddities like ① and ½.
 *
 * The punctuation is the short list real addresses need: comma and period as
 * separators, hyphen and apostrophe inside names (O'Brien, Stratford-upon-Avon),
 * `#` and `/` for unit numbers, `&` for intersections, parentheses for
 * disambiguation like Springfield (IL). The curly apostrophe `’` is included
 * because iOS and macOS substitute it for `'` automatically — rejecting it
 * would fail people for their keyboard's autocorrect.
 *
 * Everything else is refused, which is the point. Colons, quotes, brackets,
 * braces, backticks and pipes have no place in an address but are the
 * building blocks of forged prompt structure — `SYSTEM:`, `<|im_start|>`,
 * fenced blocks, fake JSON — as are newlines and every other control
 * character. See runGeminiAgentUseCase.ts, where this value is interpolated
 * into the agent's opening prompt inside a <user_location> delimiter.
 */
const ALLOWED_CHAR = /[\p{L}\p{M}\p{Nd} ,.'’#/&()-]/u;

/**
 * A location has to contain something nameable. Punctuation alone ("...",
 * "---") satisfies the allowlist but is not a place, and rejecting it here
 * is cheaper and clearer than spending a geocoder round-trip to be told so.
 */
const HAS_ALPHANUMERIC = /[\p{L}\p{Nd}]/u;

/** How many rejected characters to name back to the user before trailing off. */
const MAX_REPORTED_CHARS = 5;

/** Control characters have no printable form, so name them by code point. */
function describeChar(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f
    ? `\\u${code.toString(16).padStart(4, "0")}`
    : char;
}

/**
 * The distinct disallowed characters in `location`, in the order they appear.
 * Iterating with for..of walks code points rather than UTF-16 units, so an
 * emoji or any other astral character is judged whole instead of as two
 * unpaired halves.
 */
function disallowedCharsIn(location: string): string[] {
  const found = new Set<string>();
  for (const char of location) {
    if (!ALLOWED_CHAR.test(char)) found.add(char);
  }
  return [...found];
}

export interface SearchRequestBody {
  location?: unknown;
  urgency?: unknown;
  maxRadiusKm?: unknown;
}

export type ParseSearchRequestResult =
  | { ok: true; request: InputFormData }
  | { ok: false; kind: string; message: string; status: number };

/**
 * Validates a search request's shape before it reaches the geocoder or the
 * Gemini agent's prompt. `location` is free text a user types and, once
 * inside the agent's prompt, is data the model reads rather than a
 * sandboxed value — this is the one place to reject anything shaped like an
 * injection attempt rather than trusting the model to resist it turn after
 * turn.
 */
export function parseSearchRequest(body: SearchRequestBody | null): ParseSearchRequestResult {
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  if (!location) {
    return {
      ok: false,
      kind: "location_not_found",
      message: "Please enter a location.",
      status: 400,
    };
  }

  if (location.length > MAX_LOCATION_LENGTH) {
    return {
      ok: false,
      kind: "location_not_found",
      message: `Location is too long — please enter a place name or address under ${MAX_LOCATION_LENGTH} characters.`,
      status: 400,
    };
  }

  // Named back to the user rather than refused blankly: someone typing a real
  // address with unusual punctuation needs to know which character to drop,
  // and the allowlist is in the source anyway — there is nothing to conceal.
  const disallowed = disallowedCharsIn(location);
  if (disallowed.length > 0) {
    const shown = disallowed.slice(0, MAX_REPORTED_CHARS).map(describeChar).join("  ");
    const more = disallowed.length > MAX_REPORTED_CHARS ? ", and others" : "";
    return {
      ok: false,
      kind: "location_not_found",
      message:
        `Location can't contain: ${shown}${more}. Enter a plain place name or ` +
        `address — letters, numbers, spaces, and , . ' - # / & ( ) only.`,
      status: 400,
    };
  }

  if (!HAS_ALPHANUMERIC.test(location)) {
    return {
      ok: false,
      kind: "location_not_found",
      message: "Please enter a place name or address.",
      status: 400,
    };
  }

  const urgency = URGENCIES.includes(body?.urgency as Urgency) ? (body!.urgency as Urgency) : null;
  if (!urgency) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "Please choose a valid urgency level.",
      status: 400,
    };
  }

  const maxRadiusKm = body?.maxRadiusKm;
  if (
    typeof maxRadiusKm !== "number" ||
    !Number.isFinite(maxRadiusKm) ||
    maxRadiusKm < MIN_RADIUS_KM ||
    maxRadiusKm > MAX_RADIUS_KM
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `Max radius must be between ${MIN_RADIUS_KM} and ${MAX_RADIUS_KM} km.`,
      status: 400,
    };
  }

  return { ok: true, request: { location, urgency, maxRadiusKm } };
}
