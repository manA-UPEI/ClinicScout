import { search_clinics } from "./tools/searchClinics";
import { rank_clinics } from "./tools/rankClinics";
import { geocode } from "./tools/geocode";
import { inspect_clinic, mergeInspection } from "./tools/inspectClinic";
import { geminiConfigured } from "./tools/gemini";
import {
  AgentError,
  AgentStep,
  Clinic,
  InputFormData,
  RankedClinic,
  Urgency,
} from "./types";

// Inspecting every result in a dense city would mean a hundred page fetches and
// a minute of waiting; the ranking waterfall only ever promotes from the front
// of the list, so enriching the leaders is what actually changes the answer.
const INSPECT_LIMIT = 5;

const URGENCY_NOTE: Record<Urgency, string> = {
  routine: "routine care, so appointment-only clinics still count",
  urgent: "urgent care, so open-now and walk-in clinics rank first",
  emergency_adjacent: "urgent care, so open-now and walk-in clinics rank first",
};

export interface ExcludedSpecialty {
  clinic_name: string;
  specialty: string;
}

export interface AgentRunResult {
  steps: AgentStep[];
  ranked: RankedClinic[];
  resolvedLocation: string;
  urgency: Urgency;
  /** Specialty listings dropped before ranking, shown so the filter is auditable. */
  excluded: ExcludedSpecialty[];
}

function summarizeFindings(ranked: RankedClinic[]): string {
  const openCount = ranked.filter((c) => c.open_now === true).length;
  const unknownCount = ranked.filter((c) => c.open_now === null).length;
  const details = [
    `${openCount} confirmed open`,
    unknownCount > 0 ? `${unknownCount} with unpublished hours` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `⚖️ Comparing availability and ranking options (${details})...`;
}

async function inspectCandidates(
  clinics: Clinic[],
  steps: AgentStep[]
): Promise<Clinic[]> {
  if (!geminiConfigured()) {
    steps.push({
      id: "inspect-skipped",
      message:
        "🕵️ Skipping website inspection — no GEMINI_API_KEY set. Unverified details stay Unknown.",
    });
    return clinics;
  }

  const candidates = clinics
    .filter((c) => c.website)
    .slice(0, INSPECT_LIMIT);

  if (candidates.length === 0) {
    steps.push({
      id: "inspect-none",
      message: "🕵️ None of the top matches publish a website to inspect.",
    });
    return clinics;
  }

  steps.push({
    id: "inspect-start",
    message: `🕵️ Reading ${candidates.length} clinic ${candidates.length === 1 ? "website" : "websites"} for walk-in and booking details...`,
  });

  const inspections = await Promise.all(candidates.map(inspect_clinic));

  // Logged after the fact, in candidate order: pushing from inside the parallel
  // map would order the transparency log by whichever site responded first.
  const inspected = candidates.map((clinic, i) => {
    const inspection = inspections[i];
    steps.push({
      id: `inspect-${clinic.source_url}`,
      message:
        inspection.evidence.length > 0
          ? `  ✅ ${clinic.clinic_name}: confirmed ${inspection.evidence.map((e) => e.field.replace(/_/g, " ")).join(", ")}.`
          : `  ⚠️ ${clinic.clinic_name}: nothing verifiable on the site — details stay Unknown.`,
    });
    return mergeInspection(clinic, inspection);
  });

  const byUrl = new Map(inspected.map((c) => [c.source_url, c]));
  return clinics.map((c) => byUrl.get(c.source_url) ?? c);
}

export async function runAgent(input: InputFormData): Promise<AgentRunResult> {
  const steps: AgentStep[] = [];

  const place = await geocode(input.location);
  steps.push({
    id: "geocode",
    message: `📍 Resolved "${input.location}" to ${place.display_name}.`,
  });
  steps.push({
    id: "search",
    message: `🔍 Searching for clinics within ${input.maxRadiusKm} km (${URGENCY_NOTE[input.urgency]})...`,
  });

  const { clinics, stale } = await search_clinics(place, input.maxRadiusKm);
  if (clinics.length === 0) {
    throw new AgentError(
      "no_results",
      `No clinics are listed within ${input.maxRadiusKm} km of ${place.display_name}. Try a wider radius.`
    );
  }

  if (stale) {
    // The directory failed live, so this is our own cached copy — say so
    // rather than presenting it as a fresh lookup.
    steps.push({
      id: "stale",
      message:
        "⚠️ The clinic directory didn't respond — showing the most recent results we have, which may be a little out of date.",
    });
  }

  steps.push({
    id: "found",
    message: `Found ${clinics.length} ${clinics.length === 1 ? "clinic" : "clinics"}.`,
  });

  // OSM lumps fertility labs, LASIK centres and physiotherapists in with urgent
  // care. Dropping them here is what stops the agent confidently recommending
  // a specialist for a walk-in complaint.
  const eligible = clinics.filter((c) => c.relevance !== "specialty");
  const excluded: ExcludedSpecialty[] = clinics
    .filter((c) => c.relevance === "specialty")
    .map((c) => ({
      clinic_name: c.clinic_name,
      specialty: c.specialty ?? "Specialist referral",
    }));

  if (excluded.length > 0) {
    steps.push({
      id: "filter",
      message: `🧹 Set aside ${excluded.length} specialty ${excluded.length === 1 ? "listing" : "listings"} that don't treat general walk-in complaints.`,
    });
  }

  if (eligible.length === 0) {
    throw new AgentError(
      "no_results",
      `The ${clinics.length} listings near ${place.display_name} are all specialist services (${[...new Set(excluded.map((e) => e.specialty))].join(", ")}). Try a wider radius.`
    );
  }

  // Rank on directory data first so inspection spends its budget on the
  // clinics that could plausibly win, then rank again on what the sites said.
  const shortlist = rank_clinics(eligible, input.urgency);
  const enriched = await inspectCandidates(shortlist, steps);
  const ranked = rank_clinics(enriched, input.urgency);

  steps.push({ id: "compare", message: summarizeFindings(ranked) });
  steps.push({
    id: "recommend",
    message: `🏆 Recommendation ready: ${ranked[0].clinic_name}.`,
  });

  return {
    steps,
    ranked,
    resolvedLocation: place.display_name,
    urgency: input.urgency,
    excluded,
  };
}
