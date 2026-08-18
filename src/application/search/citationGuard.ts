import type { AgentReasoning } from "../../domain/entities/agentRun.ts";
import type { Clinic, InspectableField } from "../../domain/entities/clinic.ts";
import { INSPECTABLE_FIELDS } from "../../domain/verification/pageEvidence.ts";
import { isDeadEnd } from "../../domain/policies/actionability.ts";
import { eligibleClinics, getClinic } from "../../lib/agent/state.ts";
import type { RunState } from "../../lib/agent/state.ts";

export type FinalizationResult =
  | { ok: true; reasoning: AgentReasoning }
  | { ok: false; error: string };

/** Every field the agent is allowed to cite. Mirrors what a Clinic can actually hold. */
const CITABLE_FIELDS: InspectableField[] = INSPECTABLE_FIELDS;

function isKnown(clinic: Clinic, field: InspectableField): boolean {
  const value = clinic[field];
  return value !== null && value !== undefined && value !== "";
}

/** Fields backed by a verbatim quote from the clinic's own site, not just an OSM tag. */
function pageVerifiedFields(clinic: Clinic): Set<InspectableField> {
  return new Set(clinic.evidence.map((e) => e.field));
}

/**
 * The fact firewall.
 *
 * The agent is free to disagree with rank_clinics and pick a different clinic —
 * that judgment is the point of putting a model in charge. What it is not free
 * to do is justify the pick with something the record does not contain. Every
 * field it cites must be non-null on the stored clinic, so a reason like
 * "confirms walk-ins" is impossible unless `accepts_walk_ins` genuinely came
 * back from OpenStreetMap or from a page-verified quote.
 *
 * Rejections are phrased for the model, not for us: they go straight back as a
 * functionResponse so it can correct the citation and try again, which is a
 * real self-correction loop rather than a hard failure.
 */
export function validateFinalization(
  state: RunState,
  args: Record<string, unknown>,
  topRankedId: string | null
): FinalizationResult {
  const clinicId = typeof args.clinic_id === "string" ? args.clinic_id : "";
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  const rawFields = Array.isArray(args.cited_fields) ? args.cited_fields : null;

  const clinic = clinicId ? getClinic(state, clinicId) : undefined;
  if (!clinic) {
    return {
      ok: false,
      error:
        `Unknown clinic_id "${clinicId}". Use an id exactly as returned by ` +
        `search_clinics or rank_clinics — do not invent or reformat one.`,
    };
  }

  if (reason.length < 10) {
    return { ok: false, error: "reason must be a sentence explaining the choice." };
  }

  if (!rawFields) {
    return {
      ok: false,
      error:
        "cited_fields must be an array naming the clinic facts your reason relies on.",
    };
  }

  const unknownNames = rawFields.filter(
    (f): f is string => typeof f !== "string" || !CITABLE_FIELDS.includes(f as InspectableField)
  );
  if (unknownNames.length > 0) {
    return {
      ok: false,
      error:
        `Not citable: ${unknownNames.join(", ")}. Valid fields are: ${CITABLE_FIELDS.join(", ")}.`,
    };
  }

  const citedFields = rawFields as InspectableField[];
  const unsupported = citedFields.filter((f) => !isKnown(clinic, f));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error:
        `${clinic.clinic_name} has no confirmed value for: ${unsupported.join(", ")}. ` +
        `Unknown is not the same as false — you may not cite a field the clinic ` +
        `never confirmed. Either cite only confirmed fields, inspect its website ` +
        `first, or choose a different clinic.`,
    };
  }

  const unusable = rejectIfUnusable(state, clinic);
  if (unusable) return { ok: false, error: unusable };

  // Overruling the waterfall on no evidence at all is where a model is most
  // likely to be reasoning from nothing. Observed doing exactly that: it
  // demoted the top pick for a clinic whose hours were simply Unknown, arguing
  // that unknown left it "potentially open" — turning an absence of information
  // into a selling point, which is the one move this app exists to prevent.
  //
  // Distance, confidence and relevance are already weighed by the ranking, so
  // an override has to rest on something the ranking could not see: a confirmed
  // fact. With nothing to cite, the honest move is to defer.
  const overrodeRanking = topRankedId !== null && topRankedId !== clinicId;
  if (overrodeRanking && citedFields.length === 0) {
    const top = getClinic(state, topRankedId!);
    return {
      ok: false,
      error:
        `You are overriding the top-scored clinic${top ? ` (${top.clinic_name})` : ""} ` +
        `but cited no confirmed facts. Unknown is not a reason to prefer a clinic — ` +
        `it is the absence of one. Distance and confidence are already weighed by ` +
        `the ranking, so an override needs a confirmed fact it could not see. ` +
        `Cite one, or finalize the top-scored clinic instead.`,
    };
  }

  return {
    ok: true,
    reasoning: {
      clinic_id: clinicId,
      reason,
      cited_fields: citedFields,
      overrode_ranking: overrodeRanking,
    },
  };
}

/**
 * The floor beneath the agent's judgment.
 *
 * Letting the model overrule `rank_clinics` is the point of putting it in
 * charge, and most of that waterfall is genuinely a matter of judgment — how to
 * weigh distance against confidence against a confirmed walk-in policy. Its top
 * two tiers are not. They answer "is this a usable recommendation at all", and
 * a wrong call there hands a sick person a clinic they cannot reach or one that
 * is shut.
 *
 * Both were observed happening. Told only in the prompt to prefer open clinics,
 * the agent traded "open now" for a confirmed walk-in policy and recommended a
 * clinic the app had verified was closed. Given that rule, it promoted one with
 * no address, phone, or email at all. Judgment reliably erodes a rule that is
 * merely requested — so these are enforced, exactly as quote verification is.
 *
 * Each check only bites while a genuinely better option exists: if every clinic
 * nearby is a dead end, or every one is closed, saying so honestly is the best
 * answer available and the agent is left free to give it.
 */
function rejectIfUnusable(state: RunState, clinic: Clinic): string | null {
  const others = eligibleClinics(state).filter(
    (c) => c.source_url !== clinic.source_url
  );

  // Tier 0: somewhere the user can reach or find. Nothing else matters without it.
  if (isDeadEnd(clinic)) {
    const reachable = others.find((c) => !isDeadEnd(c));
    if (reachable) {
      return (
        `${clinic.clinic_name} has no address, phone, email or booking link — ` +
        `there is no way to reach it and no way to find it, so it is a name ` +
        `rather than a recommendation. ${reachable.clinic_name} can actually be ` +
        `contacted or visited. Only recommend an unreachable listing when every ` +
        `alternative is equally unreachable.`
      );
    }
    return null;
  }

  // Tier 1: open now, when the need is urgent.
  if (state.input.urgency !== "routine" && clinic.open_now === false) {
    const maybeOpen = others.find((c) => c.open_now !== false && !isDeadEnd(c));
    if (maybeOpen) {
      return (
        `${clinic.clinic_name} is confirmed closed right now, and this request ` +
        `is urgent. ${maybeOpen.clinic_name} is not confirmed closed, so the ` +
        `user has somewhere they could actually be seen. Unknown hours are fine ` +
        `— unknown might be open — but only recommend a closed clinic when every ` +
        `alternative is closed too.`
      );
    }
  }

  return null;
}

/** Which of a finalization's cited fields carry a page quote, for display. */
export function citedFieldsWithEvidence(
  clinic: Clinic,
  cited: InspectableField[]
): InspectableField[] {
  const verified = pageVerifiedFields(clinic);
  return cited.filter((f) => verified.has(f));
}
