import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionBySpecialty } from "../domain/policies/excludeSpecialtyListings.ts";
import type { Clinic } from "../domain/entities/clinic.ts";

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

test("keeps non-specialty clinics eligible and drops specialty ones", () => {
  const clinics = [
    clinic(1),
    clinic(2, { relevance: "specialty", specialty: "Fertility" }),
    clinic(3, { relevance: "walk_in" }),
  ];

  const { eligible, excluded } = partitionBySpecialty(clinics);

  assert.deepEqual(
    eligible.map((c) => c.clinic_name),
    ["Clinic 1", "Clinic 3"]
  );
  assert.deepEqual(excluded, [{ clinic_name: "Clinic 2", specialty: "Fertility" }]);
});

test("dedupes a chain's several branches down to one excluded entry by name", () => {
  const clinics = [
    clinic(1, { clinic_name: "Acme Fertility", relevance: "specialty", specialty: "Fertility" }),
    clinic(2, { clinic_name: "Acme Fertility", relevance: "specialty", specialty: "Fertility" }),
  ];

  const { excluded } = partitionBySpecialty(clinics);

  assert.equal(excluded.length, 1);
});

test("falls back to a generic label when a specialty clinic carries no specialty string", () => {
  const { excluded } = partitionBySpecialty([
    clinic(1, { relevance: "specialty", specialty: null }),
  ]);

  assert.equal(excluded[0].specialty, "Specialist referral");
});

test("carries alreadyExcluded forward without duplicating or dropping it", () => {
  const priorExcluded = [{ clinic_name: "Acme Fertility", specialty: "Fertility" }];

  const { excluded } = partitionBySpecialty(
    [clinic(1, { clinic_name: "Acme Fertility", relevance: "specialty", specialty: "Fertility" })],
    priorExcluded
  );

  assert.equal(excluded.length, 1);
});

test("the deterministic pipeline and the agent path agree on the same duplicate-chain input", async () => {
  const { recordSearch, createRunState, eligibleClinics } = await import("./agent/state.ts");

  const clinics = [
    clinic(1, { clinic_name: "Acme Fertility", relevance: "specialty", specialty: "Fertility" }),
    clinic(2, { clinic_name: "Acme Fertility", relevance: "specialty", specialty: "Fertility" }),
    clinic(3, { relevance: "general" }),
  ];

  const viaPipeline = partitionBySpecialty(clinics);

  const state = createRunState({ location: "x", urgency: "routine", maxRadiusKm: 5 });
  recordSearch(state, clinics, 5, false);

  assert.deepEqual(state.excluded, viaPipeline.excluded);
  assert.deepEqual(
    eligibleClinics(state).map((c) => c.clinic_name).sort(),
    viaPipeline.eligible.map((c) => c.clinic_name).sort()
  );
});
