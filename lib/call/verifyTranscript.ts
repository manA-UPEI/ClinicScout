import { normalizeForMatch } from "../tools/verifyEvidence.ts";
import type {
  CallField,
  CallFinding,
  CallOutcome,
  CallStatus,
  CallTurn,
  ClaimedFinding,
} from "./types.ts";

export const CALL_FIELDS: CallField[] = [
  "accepts_walk_ins_today",
  "current_wait",
  "next_available",
  "booking_instructions",
];

/** Shorter than this matches incidentally and proves nothing — same bar as page quotes. */
const MIN_QUOTE_CHARS = 4;

/**
 * The fact firewall, applied to speech.
 *
 * A clinic website is a document, so a claim about it is checked against the
 * page text (lib/tools/verifyEvidence.ts). A phone call is a conversation, and
 * that difference introduces a failure mode a document does not have: **half
 * the words in the transcript are the agent's own.**
 *
 * An agent that asks "so that's about forty-five minutes?" and receives a
 * noncommittal "mhm" can, if allowed to quote the whole transcript, cite its
 * own sentence as proof of a forty-five minute wait. The number was never the
 * clinic's — the agent supplied it, the clinic merely failed to argue. That is
 * how a leading question launders itself into a verified fact.
 *
 * So the haystack is built from clinic turns only. The agent's own utterances
 * are not evidence of anything, and this is enforced by construction rather
 * than by asking the model nicely.
 */
export function verifyAgainstTranscript(
  claims: ClaimedFinding[],
  transcript: CallTurn[]
): { findings: CallFinding[]; rejected: CallField[] } {
  // Only what the other party actually said. Index is kept so a finding can
  // point back at the exact turn for display.
  const clinicTurns = transcript
    .map((turn, index) => ({ index, turn }))
    .filter(({ turn }) => turn.speaker === "clinic")
    .map(({ index, turn }) => ({ index, text: normalizeForMatch(turn.text) }));

  const findings: CallFinding[] = [];
  const rejected: CallField[] = [];
  const settled = new Set<CallField>();

  for (const claim of claims) {
    if (!claim || !CALL_FIELDS.includes(claim.field)) continue;
    // One verdict per field; a second claim for the same field is ignored
    // rather than allowed to overwrite a verified one.
    if (settled.has(claim.field)) continue;

    const value = typeof claim.value === "string" ? claim.value.trim() : "";
    const quote = typeof claim.quote === "string" ? claim.quote : "";
    const needle = normalizeForMatch(quote);

    // A claim with no value is not a finding, and evidence offered for it
    // proves nothing — mirrors the null-value rule in verifyAgainstPage.
    if (value === "") continue;

    settled.add(claim.field);

    if (needle.length < MIN_QUOTE_CHARS) {
      rejected.push(claim.field);
      continue;
    }

    const match = clinicTurns.find((t) => t.text.includes(needle));
    if (!match) {
      rejected.push(claim.field);
      continue;
    }

    findings.push({
      field: claim.field,
      value,
      quote: quote.trim(),
      turnIndex: match.index,
    });
  }

  return { findings, rejected };
}

/**
 * Assembles the outcome for a finished call.
 *
 * A call that never reached a person carries no findings, whatever the
 * extractor thought it heard: there is nobody whose words could back them.
 * Discarding them here keeps a voicemail greeting from being mined for
 * "facts" about walk-in availability.
 */
export function buildOutcome(
  status: CallStatus,
  claims: ClaimedFinding[],
  transcript: CallTurn[]
): CallOutcome {
  if (status !== "completed") {
    return { status, findings: [], rejected: [] };
  }
  const { findings, rejected } = verifyAgainstTranscript(claims, transcript);
  return { status, findings, rejected };
}
