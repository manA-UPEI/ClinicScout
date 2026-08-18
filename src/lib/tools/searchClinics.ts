import { AgentError } from "../../domain/entities/errors.ts";
import type { Clinic, Confidence, Coordinates } from "../../domain/entities/clinic.ts";
import { isOpenNow } from "../../domain/policies/openingHours.ts";
import { calculate_distance } from "../../domain/policies/calculateDistance.ts";
import { classifyClinic } from "../../domain/policies/classifyClinic.ts";
import { USER_AGENT } from "./geocode.ts";
import { cacheKey, TtlCache } from "./cache.ts";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// One retry, not two: the per-attempt timeout below is deliberately generous
// (matches Overpass's own [timeout:25] query budget), so bounding the *count*
// of attempts is what keeps the worst case from stretching past a minute and
// a half with the user watching a static spinner the whole time.
const MAX_ATTEMPTS = 2;
const BACKOFF_MS = [2000];

const cache = new TtlCache<Clinic[]>(CACHE_TTL_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function buildQuery(center: Coordinates, radiusMeters: number): string {
  const around = `around:${radiusMeters},${center.lat},${center.lon}`;
  const selector = `["amenity"~"^(clinic|doctors)$"]`;
  return [
    "[out:json][timeout:25];",
    "(",
    `node${selector}(${around});`,
    `way${selector}(${around});`,
    `relation${selector}(${around});`,
    ");",
    "out center tags;",
  ].join("");
}

function coordsOf(element: OverpassElement): Coordinates | null {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lon: element.lon };
  }
  if (element.center) return { lat: element.center.lat, lon: element.center.lon };
  return null;
}

function buildAddress(tags: Record<string, string>): string | null {
  const street = tags["addr:street"];
  if (!street) return null;
  const parts = [
    [tags["addr:housenumber"], street].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:postcode"],
  ].filter(Boolean);
  return parts.join(", ");
}

// OSM records walk-in access as yes/no; anything else (or absent) stays unknown.
function parseWalkIns(tags: Record<string, string>): boolean | null {
  const value = tags["walk-in"] ?? tags["walk_in"];
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function parseAppointmentRequired(tags: Record<string, string>): boolean | null {
  const value = tags["appointment"];
  if (value === "required" || value === "yes") return true;
  if (value === "not_required" || value === "no" || value === "optional") return false;
  return null;
}

// Confidence reflects how well-sourced the record is, not how good the clinic
// is: freshly surveyed entries with real hours rank High, name-only stubs Low.
function scoreConfidence(tags: Record<string, string>): Confidence {
  const checkDate = tags["check_date"] ?? tags["survey:date"];
  const surveyedRecently =
    checkDate !== undefined &&
    !Number.isNaN(Date.parse(checkDate)) &&
    Date.now() - Date.parse(checkDate) < 1000 * 60 * 60 * 24 * 365 * 2;

  const hasHours = Boolean(tags["opening_hours"]);
  const hasContact = Boolean(
    tags["phone"] ?? tags["contact:phone"] ?? tags["website"] ?? tags["contact:website"]
  );

  if (hasHours && (surveyedRecently || hasContact)) return "High";
  if (hasHours || hasContact) return "Medium";
  return "Low";
}

function toClinic(
  element: OverpassElement,
  userLocation: Coordinates
): Clinic | null {
  const tags = element.tags;
  const coords = coordsOf(element);
  // A recommendation the user can't identify or travel to is not actionable.
  if (!tags?.name || !coords) return null;

  const openingHours = tags["opening_hours"] ?? null;
  const classification = classifyClinic(tags.name, tags);

  return {
    clinic_name: tags.name,
    address: buildAddress(tags),
    distance_km: calculate_distance(userLocation, coords).distance_km,
    phone: tags["phone"] ?? tags["contact:phone"] ?? null,
    email: tags["email"] ?? tags["contact:email"] ?? null,
    website: tags["website"] ?? tags["contact:website"] ?? null,
    source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    opening_hours: openingHours,
    open_now: isOpenNow(openingHours),
    // OpenStreetMap carries no live occupancy data, so this stays unknown
    // rather than being inferred from anything else.
    current_capacity: null,
    accepts_walk_ins: parseWalkIns(tags),
    appointment_required: parseAppointmentRequired(tags),
    booking_url: tags["contact:booking"] ?? tags["booking"] ?? null,
    // Nothing in OSM confirms a clinic accepts bookings by email, so this
    // stays unknown and such clinics correctly route to the "unverified
    // email" path rather than claiming email booking works.
    email_booking_supported: null,
    confidence: scoreConfidence(tags),
    relevance: classification.relevance,
    specialty: classification.specialty,
    evidence: [],
  };
}

function parseClinics(
  data: { elements?: OverpassElement[] },
  location: Coordinates,
  radius_km: number
): Clinic[] {
  const clinics = (data.elements ?? [])
    .map((element) => toClinic(element, location))
    .filter((clinic): clinic is Clinic => clinic !== null);

  // Overpass matches by bounding radius; enforce the user's limit exactly.
  return clinics.filter(
    (c) => c.distance_km !== null && c.distance_km <= radius_km
  );
}

export interface SearchResult {
  clinics: Clinic[];
  /** True only when a live fetch failed and this is a fallback to older data. */
  stale: boolean;
}

/**
 * The public Overpass instance rate-limits and occasionally 5xx's under load
 * — observed directly during demo runs. A single failed request used to end
 * the whole search; now a transient failure gets retried with backoff, and if
 * every attempt still fails, a cached result (even an expired one) is served
 * rather than surfacing an error the user can do nothing about.
 */
export async function search_clinics(
  location: Coordinates,
  radius_km: number
): Promise<SearchResult> {
  const key = cacheKey(location, radius_km);

  const fresh = cache.get(key);
  if (fresh) return { clinics: fresh, stale: false };

  const query = buildQuery(location, Math.round(radius_km * 1000));
  let sawResponse = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response | null;
    try {
      response = await fetch(OVERPASS_URL, {
        method: "POST",
        body: query,
        headers: { "User-Agent": USER_AGENT, "Content-Type": "text/plain" },
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      response = null;
    }

    if (response?.ok) {
      const data = (await response.json()) as { elements?: OverpassElement[] };
      const clinics = parseClinics(data, location, radius_km);
      cache.set(key, clinics);
      return { clinics, stale: false };
    }

    if (response) sawResponse = true;

    // Retry a network exception (transient DNS/connection issue) or a 429/5xx
    // (Overpass overloaded); a non-transient 4xx means the query itself is
    // wrong, and retrying it would just fail the same way three times.
    const transient = !response || response.status === 429 || response.status >= 500;
    const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
    if (!transient || isLastAttempt) break;

    await sleep(BACKOFF_MS[attempt]);
  }

  const stale = cache.getStale(key);
  if (stale) return { clinics: stale, stale: true };

  throw new AgentError(
    "network",
    sawResponse
      ? "The clinic directory is busy right now. Please try again in a moment."
      : "Could not reach the clinic directory."
  );
}
