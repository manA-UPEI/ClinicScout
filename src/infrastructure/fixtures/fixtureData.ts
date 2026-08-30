import type { Clinic, GeocodedLocation } from "../../domain/entities/clinic.ts";
import { calculate_distance } from "../../domain/policies/calculateDistance.ts";
import { classifyClinic } from "../../domain/policies/classifyClinic.ts";
import { isOpenNow } from "../../domain/policies/openingHours.ts";

/**
 * The invented world the fixture adapters serve.
 *
 * Written as OSM-shaped seeds — a name, a point, and a tag bag — rather than
 * as finished `Clinic` records, and then pushed through the same three domain
 * policies the real Overpass adapter uses (`classifyClinic`, `isOpenNow`,
 * `calculate_distance`). Hand-writing the derived fields instead would let
 * the fixtures drift into agreeing with themselves while disagreeing with the
 * policies, which is the one thing a fixture must never do.
 *
 * The set is chosen to exercise the paths that are otherwise awkward to
 * reach on demand: a clinic that should clearly win, one that needs an
 * appointment, one reachable only by phone, a specialty listing the relevance
 * filter has to drop, and one with no contact channel at all so the
 * usability floor in citationGuard.ts has something to catch.
 *
 * Every `.example` hostname is reserved by RFC 2606 and resolves nowhere, so
 * a fixture URL that escaped into a real fetch fails closed rather than
 * hitting somebody's actual server.
 */
interface ClinicSeed {
  /** OSM-style element path, e.g. "node/1001" — becomes the source_url and the short id the model sees. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
  /** What the fixture website fetcher serves for `tags.website`. Omitted when the clinic has no site. */
  page?: string;
}

/** Every location resolves here — the fixture geocoder has one answer. */
export const FIXTURE_PLACE: GeocodedLocation = {
  lat: 43.6532,
  lon: -79.3832,
  display_name: "Toronto, Ontario, Canada (fixture data — not a real search)",
  countryCode: "ca",
};

export const CLINIC_SEEDS: ClinicSeed[] = [
  {
    id: "node/9001",
    name: "Harbourfront Walk-In Clinic",
    lat: 43.639,
    lon: -79.381,
    tags: {
      healthcare: "centre",
      opening_hours: "24/7",
      phone: "+1-416-555-0101",
      website: "https://harbourfront-walkin.example",
      "addr:housenumber": "18",
      "addr:street": "Queens Quay West",
      "addr:city": "Toronto",
      check_date: "2026-07-01",
    },
    page: [
      "Harbourfront Walk-In Clinic",
      "Walk-ins are welcome — no appointment needed.",
      "We are open 24 hours a day, 7 days a week.",
      "Call us at +1-416-555-0101.",
      "Current wait time: approximately 25 minutes.",
    ].join("\n"),
  },
  {
    id: "node/9002",
    name: "Queen Street Family Practice",
    lat: 43.656,
    lon: -79.4,
    tags: {
      healthcare: "centre",
      opening_hours: "Mo-Fr 09:00-17:00",
      phone: "+1-416-555-0202",
      website: "https://queenstreet-family.example",
      "addr:housenumber": "412",
      "addr:street": "Queen Street West",
      "addr:city": "Toronto",
    },
    page: [
      "Queen Street Family Practice",
      "An appointment is required for all visits.",
      "Our hours are Monday to Friday, 9am to 5pm.",
      "Email us at bookings@queenstreet-family.example to request an appointment.",
      "Book online at https://queenstreet-family.example/book",
    ].join("\n"),
  },
  {
    id: "node/9003",
    name: "Riverside Medical Centre",
    lat: 43.668,
    lon: -79.365,
    tags: {
      healthcare: "centre",
      opening_hours: "Mo-Su 08:00-20:00",
      phone: "+1-416-555-0303",
      "addr:housenumber": "77",
      "addr:street": "River Street",
      "addr:city": "Toronto",
    },
  },
  {
    id: "node/9004",
    name: "Bayview Eye Institute",
    lat: 43.661,
    lon: -79.377,
    tags: {
      healthcare: "optometrist",
      opening_hours: "Mo-Fr 10:00-18:00",
      phone: "+1-416-555-0404",
    },
  },
  {
    id: "node/9005",
    name: "Parkdale Community Health Post",
    lat: 43.643,
    lon: -79.435,
    tags: { healthcare: "centre" },
  },
];

function address(tags: Record<string, string>): string | null {
  const street = tags["addr:street"];
  if (!street) return null;
  const number = tags["addr:housenumber"];
  return [number ? `${number} ${street}` : street, tags["addr:city"]]
    .filter(Boolean)
    .join(", ");
}

/**
 * Same confidence ladder the real adapter applies, kept simple: hours plus a
 * contact channel is High, either alone is Medium, neither is Low.
 */
function confidence(tags: Record<string, string>): Clinic["confidence"] {
  const hasHours = Boolean(tags.opening_hours);
  const hasContact = Boolean(tags.phone || tags.website || tags.email);
  if (hasHours && hasContact) return "High";
  if (hasHours || hasContact) return "Medium";
  return "Low";
}

/** One seed, pushed through the real domain policies, as the directory would return it. */
export function seedToClinic(seed: ClinicSeed, now: Date = new Date()): Clinic {
  const classification = classifyClinic(seed.name, seed.tags);
  const openingHours = seed.tags.opening_hours ?? null;

  return {
    clinic_name: seed.name,
    address: address(seed.tags),
    distance_km: calculate_distance(FIXTURE_PLACE, { lat: seed.lat, lon: seed.lon })
      .distance_km,
    phone: seed.tags.phone ?? null,
    email: seed.tags.email ?? null,
    website: seed.tags.website ?? null,
    source_url: `https://www.openstreetmap.org/${seed.id}`,
    opening_hours: openingHours,
    open_now: isOpenNow(openingHours, now),
    current_capacity: null,
    accepts_walk_ins: null,
    appointment_required: null,
    booking_url: null,
    email_booking_supported: null,
    confidence: confidence(seed.tags),
    relevance: classification.relevance,
    specialty: classification.specialty,
    evidence: [],
  };
}

/** The page text a clinic's own site serves, keyed by its website URL. */
export function fixturePageFor(websiteUrl: string): string | null {
  const seed = CLINIC_SEEDS.find((s) => s.tags.website === websiteUrl);
  return seed?.page ?? null;
}

/** Looks a seed up by the clinic name that appears in an extraction prompt. */
export function seedByName(name: string): ClinicSeed | undefined {
  return CLINIC_SEEDS.find((s) => s.name === name);
}
