import type { Clinic, ClinicInspection } from "../../domain/entities/clinic.ts";
import { isOpenNow } from "../../domain/policies/openingHours.ts";
import { fetchClinicPages } from "../../infrastructure/web/createWebsiteFetcher.ts";
import type { FetchedPage } from "../../infrastructure/web/createWebsiteFetcher.ts";
import { generateJson } from "../../infrastructure/llm/createJsonExtractionModel.ts";
import type { ResponseSchema } from "../../infrastructure/llm/createJsonExtractionModel.ts";
import {
  EMPTY_INSPECTION,
  gateOpeningHoursOsm,
  INSPECTABLE_FIELDS,
  verifyAgainstPage,
} from "../../domain/verification/pageEvidence.ts";
import { createCache } from "../../infrastructure/cache/createCache.ts";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Gemini's free-tier quota is far tighter than Overpass's, and it was the
// actual cause of a live 429 storm during this app's own testing. Caching
// verified inspections protects that budget across repeat searches, and —
// more importantly — means a request that hits the quota wall mid-run falls
// back to a fact we genuinely confirmed earlier instead of silently
// discarding it back to "Unknown".
const inspectionCache = createCache<ClinicInspection>("inspection", CACHE_TTL_MS);

const SCHEMA: ResponseSchema = {
  type: "OBJECT",
  properties: {
    current_capacity: {
      type: "STRING",
      nullable: true,
      description:
        "Stated current wait time or capacity, e.g. 'approx. 30 min wait'. Null unless the page states it.",
    },
    accepts_walk_ins: {
      type: "BOOLEAN",
      nullable: true,
      description: "True only if the page explicitly says walk-ins are accepted.",
    },
    appointment_required: {
      type: "BOOLEAN",
      nullable: true,
      description: "True only if the page explicitly says an appointment is required.",
    },
    booking_url: {
      type: "STRING",
      nullable: true,
      description: "Absolute URL of an online booking page, if the page links to one.",
    },
    email: { type: "STRING", nullable: true, description: "Contact email address." },
    email_booking_supported: {
      type: "BOOLEAN",
      nullable: true,
      description:
        "True only if the page explicitly invites booking or appointment requests by email.",
    },
    phone: { type: "STRING", nullable: true, description: "Contact phone number." },
    opening_hours: {
      type: "STRING",
      nullable: true,
      description:
        "Opening hours exactly as displayed on the page, e.g. 'Mon-Fri 9am-5pm, Sat 10am-2pm'. Copy verbatim — do not reformat. Null unless the page states hours.",
    },
    opening_hours_osm: {
      type: "STRING",
      nullable: true,
      description:
        "Your own translation of opening_hours into OpenStreetMap opening_hours syntax: two-letter day codes (Mo,Tu,We,Th,Fr,Sa,Su), 24-hour HH:MM-HH:MM ranges, ';' between day groups, e.g. 'Mo-Fr 09:00-17:00; Sa 10:00-14:00'. Write 'off' for a day explicitly stated as closed. Return null if you are not confident of an exact translation.",
    },
    evidence: {
      type: "ARRAY",
      description:
        "One entry per non-null field above EXCEPT opening_hours_osm, quoting the text that states it. opening_hours_osm is your own translation, not something to quote.",
      items: {
        type: "OBJECT",
        properties: {
          field: { type: "STRING", enum: INSPECTABLE_FIELDS },
          quote: {
            type: "STRING",
            description:
              "Text copied character-for-character from the page. Do not paraphrase, correct, or shorten mid-word.",
          },
        },
        required: ["field", "quote"],
      },
    },
  },
  required: ["evidence"],
};

function buildPrompt(clinicName: string, pages: FetchedPage[]): string {
  const pageBlocks = pages
    .map((p) => `--- PAGE: ${p.url} ---\n${p.text}`)
    .join("\n\n");

  return [
    "You are extracting facts about a walk-in medical clinic from its own website.",
    `Clinic name: ${clinicName}`,
    `${pages.length} page(s) were fetched from this clinic's site, shown below.`,
    "",
    "Rules:",
    "- Return null for any field the pages do not explicitly state. Never infer, never guess a likely default.",
    "- Absence of a statement is not evidence of the negative. If the pages never mention walk-ins, accepts_walk_ins is null, not false.",
    "- For every field you return non-null (except opening_hours_osm), add an evidence entry whose quote is copied verbatim from the page text below.",
    "- A quote that does not appear in the page text will cause that field to be discarded.",
    "- opening_hours_osm needs no quote — it is your own translation of opening_hours, not a claim the page makes.",
    "",
    pageBlocks,
  ].join("\n");
}

/** Reads whatever pages of the clinic's own site are reachable. Empty when the site can't be read at all. */
async function fetchPagesFor(clinic: Clinic): Promise<FetchedPage[]> {
  return fetchClinicPages(clinic.website!);
}

/** Asks the model to extract fields from the fetched pages. Null on any model failure. */
async function extractRaw(
  clinicName: string,
  pages: FetchedPage[]
): Promise<Partial<ClinicInspection> | null> {
  return generateJson<Partial<ClinicInspection>>(buildPrompt(clinicName, pages), SCHEMA);
}

/**
 * Checks the model's claims against the fetched pages. Quotes are checked
 * against every fetched page at once, so a fact stated on the /hours page
 * still verifies even though the model saw it alongside the landing page's
 * text.
 */
function verify(raw: Partial<ClinicInspection>, pages: FetchedPage[]): ClinicInspection {
  const haystack = pages.map((p) => p.text).join("\n");
  const verified = verifyAgainstPage(raw, haystack);

  return {
    ...verified,
    opening_hours_osm: gateOpeningHoursOsm(verified.opening_hours, raw.opening_hours_osm),
  };
}

async function inspectLive(clinic: Clinic): Promise<ClinicInspection> {
  const pages = await fetchPagesFor(clinic);
  if (pages.length === 0) return EMPTY_INSPECTION;

  const raw = await extractRaw(clinic.clinic_name, pages);
  if (!raw) return EMPTY_INSPECTION;

  return verify(raw, pages);
}

/**
 * Decides what inspect_clinic should return, and whether the result is worth
 * caching, given a just-attempted live read and whatever was last cached for
 * this clinic (if anything). Pure and network-free so it's directly testable.
 *
 * A genuine success (verified evidence) is always trusted and cached — never
 * caching a failure, since that would block recovery once whatever went
 * wrong (usually the Gemini quota) clears up. An empty live result prefers a
 * stale-but-verified fact over discarding it back to "Unknown".
 */
export function resolveInspection(
  live: ClinicInspection,
  stale: ClinicInspection | undefined
): { result: ClinicInspection; shouldCache: boolean } {
  if (live.evidence.length > 0) return { result: live, shouldCache: true };
  return { result: stale ?? live, shouldCache: false };
}

export async function inspect_clinic(clinic: Clinic): Promise<ClinicInspection> {
  if (!clinic.website) return EMPTY_INSPECTION;

  const fresh = await inspectionCache.get(clinic.website);
  if (fresh) return fresh;

  const live = await inspectLive(clinic);
  const { result, shouldCache } = resolveInspection(
    live,
    await inspectionCache.getStale(clinic.website)
  );
  if (shouldCache) await inspectionCache.set(clinic.website, result);
  return result;
}

/**
 * Website facts are first-party and fresher than the OpenStreetMap tags, so a
 * verified value replaces the OSM one; an unverified (null) value leaves the
 * OSM value untouched rather than erasing it.
 */
export function mergeInspection(
  clinic: Clinic,
  inspection: ClinicInspection
): Clinic {
  // open_now is only ever recomputed from a hours string that passed both the
  // page-quote check and the OSM-grammar check — otherwise it keeps whatever
  // OSM-tag-derived verdict the clinic already had.
  const openNow = inspection.opening_hours_osm
    ? isOpenNow(inspection.opening_hours_osm)
    : null;

  return {
    ...clinic,
    opening_hours: inspection.opening_hours ?? clinic.opening_hours,
    open_now: openNow ?? clinic.open_now,
    current_capacity: inspection.current_capacity ?? clinic.current_capacity,
    accepts_walk_ins: inspection.accepts_walk_ins ?? clinic.accepts_walk_ins,
    appointment_required:
      inspection.appointment_required ?? clinic.appointment_required,
    booking_url: inspection.booking_url ?? clinic.booking_url,
    email: inspection.email ?? clinic.email,
    email_booking_supported:
      inspection.email_booking_supported ?? clinic.email_booking_supported,
    phone: inspection.phone ?? clinic.phone,
    // Reading the clinic's own site is the strongest sourcing available here.
    confidence: inspection.evidence.length > 0 ? "High" : clinic.confidence,
    evidence: inspection.evidence,
  };
}
