import type { RankedClinic } from "../src/domain/entities/clinic.ts";

/** Builds the raw SSE wire format interface/http/sseResponse.ts sends, so a mocked route.fulfill() body is indistinguishable from a real stream. */
export function sseBody(events: { event: string; data: unknown }[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
}

/**
 * Has a phone, no email, no booking_url — the combination that routes to
 * determineAction's "call_only" case, matching what a real search against
 * this app actually produces most often (see ARCHITECTURE.md's priority
 * waterfall: a reachable clinic without online booking is common).
 */
export const MOCK_CLINIC: RankedClinic = {
  clinic_name: "Union Health",
  address: "25 York Street, Toronto, M5J 2V5",
  distance_km: 1.1,
  phone: "+1-647-498-1421",
  email: null,
  website: "https://unionhealth.ca",
  source_url: "https://www.openstreetmap.org/way/691299995",
  opening_hours: "Mo-Fr 08:00-17:00",
  open_now: true,
  current_capacity: null,
  accepts_walk_ins: null,
  appointment_required: null,
  booking_url: null,
  email_booking_supported: null,
  confidence: "High",
  relevance: "general",
  specialty: null,
  evidence: [],
  rank: 1,
  rationale: "Union Health is open now, offers general practice care, is 1.1 km away.",
};
