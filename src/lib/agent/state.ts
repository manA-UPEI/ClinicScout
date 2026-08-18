import type {
  Clinic,
  Confidence,
  ExcludedSpecialty,
  GeocodedLocation,
  Relevance,
} from "../../domain/entities/clinic.ts";
import { clinicShortId } from "../../domain/entities/clinic.ts";
import type { AgentReasoning, InputFormData } from "../../domain/entities/agentRun.ts";
import { hasContactChannel } from "../../domain/policies/actionability.ts";
import { partitionBySpecialty } from "../../domain/policies/excludeSpecialtyListings.ts";

/**
 * The agent's blackboard.
 *
 * Full `Clinic` records live here and *never* enter the model context — tools
 * hand the model compact projections plus ids, and read the real records back
 * out by id. That keeps a dense city's hundred listings from blowing the
 * context window, and makes it structurally impossible for the model to alter
 * a clinic fact: it can only ever point at one.
 */
export interface RunState {
  input: InputFormData;
  place: GeocodedLocation | null;
  /** Keyed by shortId. */
  clinics: Map<string, Clinic>;
  excluded: ExcludedSpecialty[];
  /** The radius actually searched, which self-correction may raise above the input. */
  searchedRadiusKm: number | null;
  inspected: Set<string>;
  /** True when a search fell back to cached data because the directory failed. */
  stale: boolean;
  finalized: AgentReasoning | null;
}

/** The model-facing view of a clinic: enough to choose by, nothing to copy wrong. */
export interface ClinicProjection {
  id: string;
  name: string;
  distance_km: number | null;
  open_now: boolean | null;
  relevance: Relevance;
  has_website: boolean;
  has_contact: boolean;
  confidence: Confidence;
  inspected: boolean;
}

/** Re-exported so existing importers of this module keep working under the old name. */
export const shortId = clinicShortId;

export function createRunState(input: InputFormData): RunState {
  return {
    input,
    place: null,
    clinics: new Map(),
    excluded: [],
    searchedRadiusKm: null,
    inspected: new Set(),
    stale: false,
    finalized: null,
  };
}

export function project(state: RunState, clinic: Clinic): ClinicProjection {
  const id = shortId(clinic.source_url);
  return {
    id,
    name: clinic.clinic_name,
    distance_km: clinic.distance_km,
    open_now: clinic.open_now,
    relevance: clinic.relevance,
    has_website: Boolean(clinic.website),
    has_contact: hasContactChannel(clinic),
    confidence: clinic.confidence,
    inspected: state.inspected.has(id),
  };
}

/**
 * Records a search result, splitting specialty listings out the same way the
 * deterministic pipeline does (domain/policies/excludeSpecialtyListings.ts)
 * — that filter is a safety rail, not a judgment call, so it stays out of the
 * model's hands (though the counts are reported to it, so it can reason
 * about a thin result set).
 *
 * Enrichment survives re-searching: when self-correction widens the radius, a
 * clinic already inspected keeps its verified fields instead of reverting to
 * the bare OpenStreetMap record and being re-fetched.
 */
export function recordSearch(
  state: RunState,
  clinics: Clinic[],
  radiusKm: number,
  stale: boolean
): void {
  state.searchedRadiusKm = radiusKm;
  state.stale = stale;

  const { eligible, excluded } = partitionBySpecialty(clinics, state.excluded);
  state.excluded = excluded;

  for (const clinic of eligible) {
    const id = shortId(clinic.source_url);
    if (state.inspected.has(id)) continue;
    state.clinics.set(id, clinic);
  }
}

/** Every non-specialty clinic found so far, across all searches this run. */
export function eligibleClinics(state: RunState): Clinic[] {
  return [...state.clinics.values()];
}

export function getClinic(state: RunState, id: string): Clinic | undefined {
  return state.clinics.get(id);
}

/** Replaces a clinic with its post-inspection version and marks it inspected. */
export function recordInspection(
  state: RunState,
  id: string,
  enriched: Clinic
): void {
  state.clinics.set(id, enriched);
  state.inspected.add(id);
}
