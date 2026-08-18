import type { Clinic, RankedClinic, Urgency } from "../types.ts";
import { relevanceScore } from "./classifyClinic.ts";
import { hasContactChannel, isDeadEnd } from "./actionability.ts";

// Priority waterfall, evaluated tier by tier so ties correctly fall through
// to the next criterion instead of collapsing to a single sort key:
// 0. usable at all — neither contactable nor locatable sinks to the bottom
// 1. open right now
// 2. relevance (walk-in > general practice > unclassified)
// 3. walk-ins explicitly confirmed
// 4. availability/capacity confirmed (if known)
// 5. no appointment required  — skipped for routine care, see below
// 6. reachable by some contact channel
// 7. shortest distance
// 8. higher confidence
function compareClinics(a: Clinic, b: Clinic, urgency: Urgency): number {
  // Ahead of every care signal, because none of them help if the user cannot
  // find or contact the place. A clinic that is open, takes walk-ins and has
  // no address or phone number is still not somewhere anyone can go.
  const deadEnd = (c: Clinic) => (isDeadEnd(c) ? 1 : 0);
  if (deadEnd(a) !== deadEnd(b)) return deadEnd(a) - deadEnd(b);

  // Confirmed open beats unknown, and unknown beats confirmed closed: a clinic
  // we know is shut is strictly worse than one that might be open.
  const openScore = (c: Clinic) =>
    c.open_now === true ? 0 : c.open_now === null ? 1 : 2;
  if (openScore(a) !== openScore(b)) return openScore(a) - openScore(b);

  const relevance = (c: Clinic) => relevanceScore(c.relevance);
  if (relevance(a) !== relevance(b)) return relevance(a) - relevance(b);

  const walkInScore = (c: Clinic) => (c.accepts_walk_ins === true ? 0 : 1);
  if (walkInScore(a) !== walkInScore(b)) return walkInScore(a) - walkInScore(b);

  const capacityScore = (c: Clinic) => (c.current_capacity !== null ? 0 : 1);
  if (capacityScore(a) !== capacityScore(b))
    return capacityScore(a) - capacityScore(b);

  // Needing an appointment only counts against a clinic when the user needs
  // care now. For routine care you can simply book ahead, so penalising it
  // would push genuinely suitable clinics down the list for no reason.
  if (urgency !== "routine") {
    const apptScore = (c: Clinic) => (c.appointment_required === false ? 0 : 1);
    if (apptScore(a) !== apptScore(b)) return apptScore(a) - apptScore(b);
  }

  // Above distance rather than below it: with most care signals unknown,
  // distance otherwise decides nearly every comparison, and a clinic you can
  // phone is worth more than one a hundred metres closer that you cannot.
  const reachable = (c: Clinic) => (hasContactChannel(c) ? 0 : 1);
  if (reachable(a) !== reachable(b)) return reachable(a) - reachable(b);

  const distanceScore = (c: Clinic) => c.distance_km ?? Number.POSITIVE_INFINITY;
  if (distanceScore(a) !== distanceScore(b))
    return distanceScore(a) - distanceScore(b);

  const confidenceRank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  return confidenceRank[a.confidence] - confidenceRank[b.confidence];
}

function buildRationale(c: Clinic, isTop: boolean, urgency: Urgency): string {
  const parts: string[] = [];

  if (c.open_now === true) parts.push("is open now");
  else if (c.open_now === false) parts.push("is currently closed");
  else parts.push("has no published hours to confirm it is open");

  if (c.relevance === "walk_in") parts.push("is listed as a walk-in clinic");
  else if (c.relevance === "general") parts.push("offers general practice care");

  if (c.accepts_walk_ins === true) parts.push("explicitly confirms walk-ins");
  else if (c.accepts_walk_ins === false) parts.push("does not accept walk-ins");

  if (c.appointment_required === false) parts.push("requires no appointment");
  else if (c.appointment_required === true) {
    parts.push(
      urgency === "routine"
        ? "requires an appointment, which is fine for routine care"
        : "requires an appointment"
    );
  }

  if (c.distance_km !== null) parts.push(`is ${c.distance_km} km away`);

  const summary = `${c.clinic_name} ${parts.join(", ")}.`;

  // Ranked last for a reason, and the reason should be visible. Saying nothing
  // would leave the user to discover the dead end for themselves.
  if (isDeadEnd(c)) {
    return `${summary} We found no address, phone number, or email for this listing — look it up before travelling.`;
  }
  if (!hasContactChannel(c)) {
    return `${summary} No contact details are listed, so you would need to turn up in person.`;
  }
  if (isTop && c.open_now !== true) {
    return `${summary} Call ahead — we could not verify it is open right now.`;
  }
  return summary;
}

export function rank_clinics(
  clinics: Clinic[],
  urgency: Urgency
): RankedClinic[] {
  const scored = [...clinics].sort((a, b) => compareClinics(a, b, urgency));
  return scored.map((c, i) => ({
    ...c,
    rank: i + 1,
    rationale: buildRationale(c, i === 0, urgency),
  }));
}
