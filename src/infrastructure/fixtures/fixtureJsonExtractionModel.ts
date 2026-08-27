import type { ClinicInspection, Evidence } from "../../domain/entities/clinic.ts";
import type { ResponseSchema } from "../llm/geminiJsonClient.ts";
import { EMPTY_INSPECTION } from "../../domain/verification/pageEvidence.ts";
import { seedByName } from "./fixtureData.ts";

/**
 * Stands in for both single-shot Gemini extractions: clinic-website fields
 * and call-transcript findings.
 *
 * One adapter serves both because the port is one method. Which of the two is
 * being asked for is decided by the schema, not by a flag threaded down from
 * the call site — the caller shouldn't have to know a fixture exists.
 */
function isInspectionSchema(schema: ResponseSchema): boolean {
  return Boolean(schema.properties && "accepts_walk_ins" in schema.properties);
}

/** The prompt's "Clinic name: X" line is how the extraction identifies its subject. */
function clinicNameFrom(prompt: string): string | null {
  return prompt.match(/^Clinic name: (.+)$/m)?.[1]?.trim() ?? null;
}

interface RawInspection extends Partial<ClinicInspection> {
  evidence: Evidence[];
}

/**
 * Canned extractions, written to agree with the page text in fixtureData.ts.
 *
 * Every quote below appears verbatim in that page, which is the whole point:
 * these results go through the same `verifyAgainstPage` firewall as a real
 * model's, so a fixture that quoted something the page never said would have
 * its fields discarded and show up as Unknown — the fixture would fail the
 * way a hallucinating model fails, rather than silently passing.
 */
const INSPECTIONS: Record<string, RawInspection> = {
  "Harbourfront Walk-In Clinic": {
    accepts_walk_ins: true,
    appointment_required: false,
    current_capacity: "approximately 25 minutes",
    phone: "+1-416-555-0101",
    opening_hours: "24 hours a day, 7 days a week",
    opening_hours_osm: "24/7",
    evidence: [
      {
        field: "accepts_walk_ins",
        quote: "Walk-ins are welcome — no appointment needed.",
      },
      { field: "appointment_required", quote: "no appointment needed" },
      {
        field: "current_capacity",
        quote: "Current wait time: approximately 25 minutes.",
      },
      { field: "phone", quote: "Call us at +1-416-555-0101." },
      {
        field: "opening_hours",
        quote: "We are open 24 hours a day, 7 days a week.",
      },
    ],
  },
  "Queen Street Family Practice": {
    appointment_required: true,
    email: "bookings@queenstreet-family.example",
    email_booking_supported: true,
    booking_url: "https://queenstreet-family.example/book",
    opening_hours: "Monday to Friday, 9am to 5pm",
    opening_hours_osm: "Mo-Fr 09:00-17:00",
    evidence: [
      {
        field: "appointment_required",
        quote: "An appointment is required for all visits.",
      },
      {
        field: "email",
        quote:
          "Email us at bookings@queenstreet-family.example to request an appointment.",
      },
      {
        field: "email_booking_supported",
        quote:
          "Email us at bookings@queenstreet-family.example to request an appointment.",
      },
      {
        field: "booking_url",
        quote: "Book online at https://queenstreet-family.example/book",
      },
      {
        field: "opening_hours",
        quote: "Our hours are Monday to Friday, 9am to 5pm.",
      },
    ],
  },
};

function inspectionFor(prompt: string): RawInspection {
  const name = clinicNameFrom(prompt);
  const seed = name ? seedByName(name) : undefined;
  if (!name || !seed) return { ...EMPTY_INSPECTION };
  return INSPECTIONS[name] ?? { ...EMPTY_INSPECTION };
}

interface ClaimedFindingShape {
  field: string;
  value: string;
  quote: string;
}

/**
 * Which call fields a spoken line could be evidence for, and how to phrase
 * the value. Order matters only in that the first match wins per field.
 */
const CALL_MATCHERS: {
  field: string;
  test: RegExp;
  value: (line: string) => string;
}[] = [
  {
    field: "accepts_walk_ins_today",
    test: /walk[- ]?in/i,
    value: (line) => (/\b(no|not|can't|cannot|full)\b/i.test(line) ? "No" : "Yes"),
  },
  {
    field: "current_wait",
    test: /\b(wait|minutes|hour)\b/i,
    value: (line) => line.match(/\b(?:about |around |roughly )?\d+\s*(?:min\w*|hour\w*)/i)?.[0] ?? "stated on the call",
  },
  {
    field: "next_available",
    test: /\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    value: (line) =>
      line.match(
        /\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b[^.]*/i
      )?.[0] ?? "stated on the call",
  },
];

/**
 * Builds findings out of the transcript in the prompt rather than from a
 * canned list.
 *
 * The mock call provider improvises per persona, so a hardcoded quote would
 * only match one of its scripts and silently produce zero verified findings
 * against the others. Quoting the clinic's own lines back means the
 * transcript firewall always has something real to verify, whichever persona
 * answered — and the clinic-turns-only rule is honoured by construction,
 * since only CLINIC lines are read.
 */
function findingsFor(prompt: string): { findings: ClaimedFindingShape[] } {
  const clinicLines = [...prompt.matchAll(/^CLINIC: (.+)$/gm)].map((m) => m[1].trim());
  const findings: ClaimedFindingShape[] = [];
  const seen = new Set<string>();

  for (const line of clinicLines) {
    for (const matcher of CALL_MATCHERS) {
      if (seen.has(matcher.field) || !matcher.test.test(line)) continue;
      seen.add(matcher.field);
      findings.push({ field: matcher.field, value: matcher.value(line), quote: line });
    }
  }

  return { findings };
}

/** Always "configured": a fixture run must never take the no-API-key fallback path. */
export function fixtureGeminiConfigured(): boolean {
  return true;
}

export async function fixtureGenerateJson<T>(
  prompt: string,
  schema: ResponseSchema
): Promise<T | null> {
  const result = isInspectionSchema(schema) ? inspectionFor(prompt) : findingsFor(prompt);
  return result as T;
}
