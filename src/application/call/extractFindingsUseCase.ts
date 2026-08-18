import { generateJson, geminiConfigured } from "../../infrastructure/llm/geminiJsonClient.ts";
import type { ResponseSchema } from "../../infrastructure/llm/geminiJsonClient.ts";
import { CALL_FIELDS } from "../../domain/verification/transcriptEvidence.ts";
import type { CallTurn, ClaimedFinding } from "../../domain/entities/call.ts";

/**
 * Reads a finished transcript and proposes what the clinic said.
 *
 * Everything this returns is a *claim*. Nothing here is trusted — the output
 * goes straight into verifyAgainstTranscript, which throws away anything not
 * quotable from a clinic turn. That separation is the point: extraction is
 * allowed to be optimistic precisely because verification is not.
 */

const SCHEMA: ResponseSchema = {
  type: "OBJECT",
  properties: {
    findings: {
      type: "ARRAY",
      description:
        "One entry per fact the CLINIC stated. Omit anything they did not say.",
      items: {
        type: "OBJECT",
        properties: {
          field: { type: "STRING", enum: CALL_FIELDS },
          value: {
            type: "STRING",
            description:
              "The fact in a few words, e.g. 'Yes', 'about 45 minutes', 'Thursday at 2pm'.",
          },
          quote: {
            type: "STRING",
            description:
              "Copied character-for-character from a line the CLINIC spoke. Never quote the assistant's own words, and never paraphrase.",
          },
        },
        required: ["field", "value", "quote"],
      },
    },
  },
  required: ["findings"],
};

function buildPrompt(transcript: CallTurn[]): string {
  const script = transcript
    .map((t) => `${t.speaker === "agent" ? "ASSISTANT" : "CLINIC"}: ${t.text}`)
    .join("\n");

  return [
    "Below is a transcript of a phone call between an automated assistant and a medical clinic's reception.",
    "Extract only facts the CLINIC stated about walk-in availability.",
    "",
    "Rules:",
    "- Quote only lines spoken by CLINIC. A quote taken from an ASSISTANT line will be discarded.",
    "- If the assistant proposed a number and the clinic only agreed vaguely, that is not a stated fact. Omit it.",
    "- Omit any field the clinic did not clearly state. Absence of a statement is not a negative answer.",
    "- Copy quotes verbatim. A quote that does not appear in the transcript will be discarded.",
    "",
    script,
  ].join("\n");
}

/**
 * Sentence-level scan used when no model is configured.
 *
 * Deliberately conservative: it only claims a field when a clinic sentence
 * carries an unambiguous signal, and it quotes that exact sentence. A vague
 * answer ("uh, maybe, I'm not sure") matches nothing and yields no claim,
 * which is the honest outcome rather than a hedged guess.
 */
function extractHeuristically(transcript: CallTurn[]): ClaimedFinding[] {
  const claims: ClaimedFinding[] = [];
  const taken = new Set<string>();

  const add = (field: ClaimedFinding["field"], value: string, quote: string) => {
    if (taken.has(field)) return;
    taken.add(field);
    claims.push({ field, value, quote });
  };

  for (const turn of transcript) {
    if (turn.speaker !== "clinic") continue;

    for (const raw of turn.text.split(/(?<=[.!?])\s+/)) {
      const sentence = raw.trim();
      if (!sentence) continue;

      if (/walk[-\s]?ins?\b/i.test(sentence)) {
        const yes = /\b(yes|yep|yeah|welcome|accepting|taking|sure|come on (in|down))\b/i.test(
          sentence
        );
        const no = /\b(no|not|aren'?t|don'?t|appointment only|fully booked|closed|afraid)\b/i.test(
          sentence
        );
        // Only an unambiguous sentence counts. "Yes, walk-ins welcome, no
        // appointment needed" and "No walk-ins, appointments only" both carry
        // signals in each direction, and guessing which one dominates is
        // exactly the coin-flip this app refuses to make.
        if (yes && !no) add("accepts_walk_ins_today", "Yes", sentence);
        else if (no && !yes) add("accepts_walk_ins_today", "No", sentence);
      }

      const wait = /\b(?:about|around|roughly|approximately)?\s*(\d{1,3}(?:\s*(?:to|-|–)\s*\d{1,3})?)\s*(minutes?|mins?|hours?|hrs?)\b/i.exec(
        sentence
      );
      if (wait && /\b(wait|waiting|queue|ahead of you|right now|currently)\b/i.test(sentence)) {
        add("current_wait", `${wait[1]} ${wait[2]}`.replace(/\s+/g, " "), sentence);
      }

      if (
        /\b(next available|next opening|book(ing)? (you )?in|we could see|earliest)\b/i.test(sentence) &&
        /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d{1,2}\s*(am|pm))\b/i.test(
          sentence
        )
      ) {
        add("next_available", sentence.replace(/^[^A-Za-z0-9]+/, ""), sentence);
      }

      if (/\b(call back|book online|our website|book through|come in person|register at)\b/i.test(sentence)) {
        add("booking_instructions", sentence.replace(/^[^A-Za-z0-9]+/, ""), sentence);
      }
    }
  }

  return claims;
}

interface RawExtraction {
  findings?: { field?: string; value?: string; quote?: string }[];
}

export async function extractFindings(
  transcript: CallTurn[]
): Promise<ClaimedFinding[]> {
  const hasClinicSpeech = transcript.some((t) => t.speaker === "clinic");
  if (!hasClinicSpeech) return [];

  if (!geminiConfigured()) return extractHeuristically(transcript);

  const raw = await generateJson<RawExtraction>(buildPrompt(transcript), SCHEMA);
  // Same degradation the website inspector uses: an unreachable model means
  // fewer confirmed facts, never a blocked call or an invented one.
  if (!raw?.findings) return extractHeuristically(transcript);

  return raw.findings
    .filter(
      (f): f is { field: string; value: string; quote: string } =>
        typeof f?.field === "string" &&
        typeof f?.value === "string" &&
        typeof f?.quote === "string"
    )
    .map((f) => ({
      field: f.field as ClaimedFinding["field"],
      value: f.value,
      quote: f.quote,
    }));
}

export { extractHeuristically };
