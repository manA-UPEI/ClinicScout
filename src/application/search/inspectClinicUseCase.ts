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

/** Fields extracted per clinic. Shared between BATCH_SCHEMA's items and nowhere else, since there's only one call site now. */
const PER_CLINIC_PROPERTIES = {
  website: {
    type: "STRING" as const,
    description: "Exactly the website value shown for this clinic above — used to match this entry back to the right clinic.",
  },
  current_capacity: {
    type: "STRING" as const,
    nullable: true,
    description:
      "Stated current wait time or capacity, e.g. 'approx. 30 min wait'. Null unless the page states it.",
  },
  accepts_walk_ins: {
    type: "BOOLEAN" as const,
    nullable: true,
    description: "True only if the page explicitly says walk-ins are accepted.",
  },
  appointment_required: {
    type: "BOOLEAN" as const,
    nullable: true,
    description: "True only if the page explicitly says an appointment is required.",
  },
  booking_url: {
    type: "STRING" as const,
    nullable: true,
    description: "Absolute URL of an online booking page, if the page links to one.",
  },
  email: { type: "STRING" as const, nullable: true, description: "Contact email address." },
  email_booking_supported: {
    type: "BOOLEAN" as const,
    nullable: true,
    description:
      "True only if the page explicitly invites booking or appointment requests by email.",
  },
  phone: { type: "STRING" as const, nullable: true, description: "Contact phone number." },
  opening_hours: {
    type: "STRING" as const,
    nullable: true,
    description:
      "Opening hours exactly as displayed on the page, e.g. 'Mon-Fri 9am-5pm, Sat 10am-2pm'. Copy verbatim — do not reformat. Null unless the page states hours.",
  },
  opening_hours_osm: {
    type: "STRING" as const,
    nullable: true,
    description:
      "Your own translation of opening_hours into OpenStreetMap opening_hours syntax: two-letter day codes (Mo,Tu,We,Th,Fr,Sa,Su), 24-hour HH:MM-HH:MM ranges, ';' between day groups, e.g. 'Mo-Fr 09:00-17:00; Sa 10:00-14:00'. Write 'off' for a day explicitly stated as closed. Return null if you are not confident of an exact translation.",
  },
  evidence: {
    type: "ARRAY" as const,
    description:
      "One entry per non-null field above EXCEPT opening_hours_osm, quoting the text that states it, from THIS CLINIC's own page text only. opening_hours_osm is your own translation, not something to quote.",
    items: {
      type: "OBJECT" as const,
      properties: {
        field: { type: "STRING" as const, enum: INSPECTABLE_FIELDS },
        quote: {
          type: "STRING" as const,
          description:
            "Text copied character-for-character from this clinic's own page. Do not paraphrase, correct, or shorten mid-word.",
        },
      },
      required: ["field", "quote"],
    },
  },
};

const BATCH_SCHEMA: ResponseSchema = {
  type: "OBJECT",
  properties: {
    clinics: {
      type: "ARRAY",
      description: "One entry per \"=== CLINIC N ===\" block above, matched back by the `website` field.",
      items: {
        type: "OBJECT",
        properties: PER_CLINIC_PROPERTIES,
        required: ["website", "evidence"],
      },
    },
  },
  required: ["clinics"],
};

interface InspectionCandidate {
  clinic: Clinic;
  pages: FetchedPage[];
}

/**
 * One prompt covering every candidate at once — see the module doc comment
 * below `extractRawBatch` for why. Each clinic gets its own labelled block;
 * the website URL is the field the model echoes back to match its answer to
 * the right clinic, since it's the one identifier guaranteed both unique and
 * already known to whoever's reading the response (a short id is an
 * agent-only concept — this use-case also serves the deterministic pipeline).
 */
function buildBatchPrompt(candidates: InspectionCandidate[]): string {
  const blocks = candidates
    .map(({ clinic, pages }, i) => {
      const pageBlocks = pages
        .map((p) => `--- PAGE: ${p.url} ---\n${p.text}`)
        .join("\n\n");
      return [
        `=== CLINIC ${i + 1} ===`,
        `Clinic name: ${clinic.clinic_name}`,
        `Clinic website: ${clinic.website}`,
        `${pages.length} page(s) were fetched from this clinic's site, shown below.`,
        "",
        pageBlocks,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "You are extracting facts about walk-in medical clinics from their own websites.",
    "Below are one or more clinics, each in its own \"=== CLINIC N ===\" block with its name and website.",
    "Return one entry in the `clinics` array of your response per clinic block, each carrying the",
    "exact `website` value shown for that clinic so answers can be matched back correctly.",
    "",
    "Rules:",
    "- Return null for any field the pages do not explicitly state. Never infer, never guess a likely default.",
    "- Absence of a statement is not evidence of the negative. If the pages never mention walk-ins, accepts_walk_ins is null, not false.",
    "- For every field you return non-null (except opening_hours_osm), add an evidence entry whose quote is copied verbatim from THAT CLINIC'S OWN page text above — never from another clinic's block.",
    "- A quote that does not appear in that clinic's own page text will cause that field to be discarded.",
    "- opening_hours_osm needs no quote — it is your own translation of opening_hours, not a claim the page makes.",
    "",
    blocks,
  ].join("\n");
}

interface BatchInspectionEntry extends Partial<ClinicInspection> {
  website?: string;
}

/**
 * One `generateJson` call for however many candidates are passed in — the
 * Gemini-quota win when there are several. But it is not a free win: it
 * trades wall-clock latency for that. Measured live against 3 real clinics,
 * one combined call took roughly twice as long as three parallel single-
 * clinic calls (~15s vs ~8s) — generating N clinics' worth of structured
 * output is a longer, unavoidably sequential token stream, where three
 * separate small calls just race each other and finish in whichever one is
 * slowest. See `extractRaw` below for the threshold this pushes the actual
 * decision to.
 *
 * Extraction is batched, but verification is not: `verifyAgainstPage` still
 * runs once per clinic against only that clinic's own fetched text (see
 * `inspect_clinics_batch` below), so a quote can never be "verified" against
 * a page it didn't actually come from, even if the model mixed clinics up.
 */
async function extractRawBatch(
  candidates: InspectionCandidate[]
): Promise<Map<string, Partial<ClinicInspection>>> {
  const result = await generateJson<{ clinics: BatchInspectionEntry[] }>(
    buildBatchPrompt(candidates),
    BATCH_SCHEMA
  );

  const byWebsite = new Map<string, Partial<ClinicInspection>>();
  for (const entry of result?.clinics ?? []) {
    if (entry?.website) byWebsite.set(entry.website, entry);
  }
  return byWebsite;
}

/**
 * Below this many candidates, run one `extractRawBatch` call *per* clinic in
 * parallel instead of one combined call for all of them — reusing the exact
 * same prompt/schema machinery with a one-item candidate list each time, just
 * not sharing a single request. For 1-2 clinics the quota saved by combining
 * is small (one call, maybe two) and the measured latency cost is real and
 * immediate; that trade only starts looking worth it once there are enough
 * clinics that the quota saved is worth more than a request or two.
 */
const BATCH_FROM_COUNT = 3;

/**
 * Extracts every candidate's raw fields, picking parallel-per-clinic or one
 * combined call based on how many there are — see `BATCH_FROM_COUNT` above.
 */
async function extractRaw(
  candidates: InspectionCandidate[]
): Promise<Map<string, Partial<ClinicInspection>>> {
  if (candidates.length < BATCH_FROM_COUNT) {
    const byWebsite = new Map<string, Partial<ClinicInspection>>();
    await Promise.all(
      candidates.map(async (candidate) => {
        const single = await extractRawBatch([candidate]);
        const entry = single.get(candidate.clinic.website!);
        if (entry) byWebsite.set(candidate.clinic.website!, entry);
      })
    );
    return byWebsite;
  }

  return extractRawBatch(candidates);
}

/** Reads whatever pages of the clinic's own site are reachable. Empty when the site can't be read at all. */
async function fetchPagesFor(clinic: Clinic): Promise<FetchedPage[]> {
  return fetchClinicPages(clinic.website!);
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

/**
 * Decides what one clinic's inspection should resolve to, and whether the
 * result is worth caching, given a just-attempted live read and whatever was
 * last cached for it (if anything). Pure and network-free so it's directly
 * testable.
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

/**
 * Inspects every given clinic (each must have a website — callers already
 * filter for this), returning results keyed by website. Clinics already
 * cached, or whose site has nothing fetchable, never touch Gemini at all;
 * whatever's left is extracted per `extractRaw`'s parallel-vs-combined
 * decision and verified per-clinic before being cached individually, same
 * as a single inspection always was.
 */
export async function inspect_clinics_batch(
  clinics: Clinic[]
): Promise<Map<string, ClinicInspection>> {
  const results = new Map<string, ClinicInspection>();
  const needsLive: InspectionCandidate[] = [];

  await Promise.all(
    clinics
      .filter((c): c is Clinic & { website: string } => Boolean(c.website))
      .map(async (clinic) => {
        const fresh = await inspectionCache.get(clinic.website);
        if (fresh) {
          results.set(clinic.website, fresh);
          return;
        }

        const pages = await fetchPagesFor(clinic);
        if (pages.length === 0) {
          results.set(clinic.website, EMPTY_INSPECTION);
          return;
        }

        needsLive.push({ clinic, pages });
      })
  );

  if (needsLive.length === 0) return results;

  const rawByWebsite = await extractRaw(needsLive);

  await Promise.all(
    needsLive.map(async ({ clinic, pages }) => {
      const website = clinic.website!;
      const raw = rawByWebsite.get(website);
      const live = raw ? verify(raw, pages) : EMPTY_INSPECTION;
      const { result, shouldCache } = resolveInspection(
        live,
        await inspectionCache.getStale(website)
      );
      if (shouldCache) await inspectionCache.set(website, result);
      results.set(website, result);
    })
  );

  return results;
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
