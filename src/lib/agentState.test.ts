import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRunState,
  eligibleClinics,
  project,
  recordInspection,
  recordSearch,
  shortId,
} from "../application/search/agentState.ts";
import type { Clinic } from "../domain/entities/clinic.ts";
import type { InputFormData } from "../domain/entities/agentRun.ts";

const INPUT: InputFormData = {
  location: "Charlottetown, PEI",
  urgency: "urgent",
  maxRadiusKm: 5,
};

function clinic(id: number, overrides: Partial<Clinic> = {}): Clinic {
  return {
    clinic_name: `Clinic ${id}`,
    address: "1 Main St",
    distance_km: 1,
    phone: "555-0100",
    email: null,
    website: "https://example.com",
    source_url: `https://www.openstreetmap.org/node/${id}`,
    opening_hours: null,
    open_now: null,
    current_capacity: null,
    accepts_walk_ins: null,
    appointment_required: null,
    booking_url: null,
    email_booking_supported: null,
    confidence: "Medium",
    relevance: "general",
    specialty: null,
    evidence: [],
    ...overrides,
  };
}

test("shortId strips the OpenStreetMap boilerplate", () => {
  assert.equal(shortId("https://www.openstreetmap.org/node/123"), "node/123");
  assert.equal(shortId("https://www.openstreetmap.org/way/456"), "way/456");
  assert.equal(shortId("https://www.openstreetmap.org/relation/7"), "relation/7");
});

test("shortId falls back to the whole url when it does not match", () => {
  assert.equal(shortId("https://example.com/x"), "https://example.com/x");
});

test("the model-facing projection exposes no raw contact strings", () => {
  const state = createRunState(INPUT);
  const projected = project(state, clinic(1, { phone: "555-0100", address: "1 Main St" }));

  const keys = Object.keys(projected).sort();
  assert.deepEqual(keys, [
    "confidence",
    "distance_km",
    "has_contact",
    "has_website",
    "id",
    "inspected",
    "name",
    "open_now",
    "relevance",
  ]);
  assert.equal(projected.has_contact, true);
});

test("recordSearch separates specialty listings from eligible ones", () => {
  const state = createRunState(INPUT);
  recordSearch(
    state,
    [
      clinic(1),
      clinic(2, { relevance: "specialty", specialty: "Eye care" }),
      clinic(3, { relevance: "walk_in" }),
    ],
    5,
    false
  );

  assert.equal(eligibleClinics(state).length, 2);
  assert.deepEqual(state.excluded, [{ clinic_name: "Clinic 2", specialty: "Eye care" }]);
  assert.equal(state.searchedRadiusKm, 5);
});

test("a widened re-search accumulates results instead of replacing them", () => {
  const state = createRunState(INPUT);
  recordSearch(state, [clinic(1)], 5, false);
  recordSearch(state, [clinic(1), clinic(2)], 15, false);

  assert.equal(eligibleClinics(state).length, 2);
  assert.equal(state.searchedRadiusKm, 15);
});

test("a re-search does not discard an already-inspected clinic's findings", () => {
  const state = createRunState(INPUT);
  recordSearch(state, [clinic(1)], 5, false);

  recordInspection(
    state,
    "node/1",
    clinic(1, {
      accepts_walk_ins: true,
      evidence: [{ field: "accepts_walk_ins", quote: "walk-ins welcome" }],
    })
  );

  // The bare OSM record comes back in the wider search; the enriched one must win.
  recordSearch(state, [clinic(1), clinic(2)], 15, false);

  const kept = state.clinics.get("node/1");
  assert.equal(kept?.accepts_walk_ins, true);
  assert.equal(kept?.evidence.length, 1);
  assert.equal(project(state, kept!).inspected, true);
});

test("the same specialty listing is not recorded twice across searches", () => {
  const state = createRunState(INPUT);
  const eye = clinic(2, { relevance: "specialty", specialty: "Eye care" });
  recordSearch(state, [eye], 5, false);
  recordSearch(state, [eye], 15, false);

  assert.equal(state.excluded.length, 1);
});

test("recordSearch reports a stale directory read", () => {
  const state = createRunState(INPUT);
  recordSearch(state, [clinic(1)], 5, true);
  assert.equal(state.stale, true);
});
