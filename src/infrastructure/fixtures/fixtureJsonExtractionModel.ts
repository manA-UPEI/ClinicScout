import type { ClinicInspection, Evidence } from "../../domain/entities/clinic.ts";
import { EMPTY_INSPECTION } from "../../domain/verification/pageEvidence.ts";
import { seedByName } from "./fixtureData.ts";

interface ClinicBlock {
  name: string;
  website: string;
}

/**
 * The real prompt (inspectClinicUseCase.ts's buildBatchPrompt) labels every
 * clinic with a "Clinic name:" / "Clinic website:" pair, one per
 * "=== CLINIC N ===" block, in that order — matching them up by position is
 * exactly what the real model is asked to do, just without an LLM in the
 * loop.
 */
function clinicBlocksFrom(prompt: string): ClinicBlock[] {
  const names = [...prompt.matchAll(/^Clinic name: (.+)$/gm)].map((m) => m[1].trim());
  const websites = [...prompt.matchAll(/^Clinic website: (.+)$/gm)].map((m) => m[1].trim());
  return names
    .map((name, i) => ({ name, website: websites[i] }))
    .filter((b): b is ClinicBlock => Boolean(b.website));
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

function inspectionFor(block: ClinicBlock): RawInspection & { website: string } {
  const seed = seedByName(block.name);
  const base = seed ? INSPECTIONS[block.name] : undefined;
  return { ...(base ?? EMPTY_INSPECTION), website: block.website };
}

/** Always "configured": a fixture run must never take the no-API-key fallback path. */
export function fixtureGeminiConfigured(): boolean {
  return true;
}

/**
 * Mirrors the real batch contract: one prompt can carry several clinics, and
 * the response is `{ clinics: [...] }` matched back by `website` — same
 * shape inspectClinicUseCase.ts's extractRawBatch expects from a real model.
 */
export async function fixtureGenerateJson<T>(prompt: string): Promise<T | null> {
  const clinics = clinicBlocksFrom(prompt).map(inspectionFor);
  return { clinics } as T;
}
