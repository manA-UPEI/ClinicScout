import type { AgentStep } from "../../../domain/entities/agentRun.ts";

/**
 * Pure step-log formatters for the two tools whose transparency-log message
 * takes more than a one-liner to build (search_clinics and
 * inspect_clinic_websites) — pulled out of their `execute` bodies so the
 * message-construction logic is unit-testable on its own.
 */

/** The transparency-log line for one search_clinics call: widened vs. fresh search, a stale-cache warning if relevant, and the resulting counts. */
export function formatSearchStep(input: {
  radiusKm: number;
  widened: boolean;
  stale: boolean;
  eligibleCount: number;
  excludedCount: number;
}): AgentStep {
  const parts: string[] = [];
  if (input.widened) {
    parts.push(
      `🔁 Widening the search to ${input.radiusKm} km — the first pass was too thin to recommend from.`
    );
  } else {
    parts.push(`🔍 Searching for clinics within ${input.radiusKm} km...`);
  }
  if (input.stale) {
    parts.push(
      "⚠️ The clinic directory didn't respond — showing the most recent results we have."
    );
  }

  return {
    id: `search-${input.radiusKm}`,
    message: `${parts.join(" ")} Found ${input.eligibleCount} general ${
      input.eligibleCount === 1 ? "clinic" : "clinics"
    }${input.excludedCount > 0 ? `, set aside ${input.excludedCount} specialty` : ""}.`,
  };
}

/** The transparency-log line for one inspect_clinic_websites call, naming what was confirmed per clinic or saying plainly that nothing was. */
export function formatInspectStep(
  ids: string[],
  targetCount: number,
  results: { name: string; page_verified_evidence: { field: string }[] }[]
): AgentStep {
  const confirmed = results.filter((r) => r.page_verified_evidence.length > 0);
  const detail = confirmed.length
    ? confirmed
        .map(
          (r) =>
            `${r.name}: ${r.page_verified_evidence.map((e) => e.field.replace(/_/g, " ")).join(", ")}`
        )
        .join("; ")
    : "nothing verifiable on those sites — details stay Unknown";

  return {
    id: `inspect-${ids.join(",")}`,
    message: `🕵️ Read ${targetCount} clinic ${
      targetCount === 1 ? "website" : "websites"
    } — ${detail}.`,
  };
}
