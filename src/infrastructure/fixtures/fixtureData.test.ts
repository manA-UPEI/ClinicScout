import { test } from "node:test";
import assert from "node:assert/strict";
import { CLINIC_SEEDS, fixturePageFor, seedToClinic } from "./fixtureData.ts";
import { isDeadEnd } from "../../domain/policies/actionability.ts";

test("every seed converts to a clinic with a distance from the fixture place", () => {
  for (const seed of CLINIC_SEEDS) {
    const clinic = seedToClinic(seed);
    assert.equal(typeof clinic.distance_km, "number");
    assert.ok(clinic.distance_km! > 0, `${seed.name} should not sit on the search point`);
  }
});

// The fixture set exists to reach paths that are otherwise awkward to trigger
// on demand. If one of these stops holding, the fixture has quietly lost the
// coverage it was written for.
test("the set contains a specialty listing for the relevance filter to drop", () => {
  const specialty = CLINIC_SEEDS.map((s) => seedToClinic(s)).filter(
    (c) => c.relevance === "specialty"
  );
  assert.equal(specialty.length, 1);
  assert.equal(specialty[0].clinic_name, "Bayview Eye Institute");
});

test("the set contains a dead end for the usability floor to catch", () => {
  const deadEnds = CLINIC_SEEDS.map((s) => seedToClinic(s)).filter(isDeadEnd);
  assert.equal(deadEnds.length, 1);
  assert.equal(deadEnds[0].clinic_name, "Parkdale Community Health Post");
});

test("the set contains a clinic that is open whatever the time of day", () => {
  const alwaysOpen = CLINIC_SEEDS.map((s) => seedToClinic(s)).filter(
    (c) => c.opening_hours === "24/7"
  );
  assert.equal(alwaysOpen.length, 1);
  assert.equal(alwaysOpen[0].open_now, true);
});

test("relevance and open_now come from the real policies, not hand-written", () => {
  // 24/7 parsed by isOpenNow, and a healthcare=centre tag left non-specialty.
  const clinic = seedToClinic(CLINIC_SEEDS[0]);
  assert.equal(clinic.open_now, true);
  assert.notEqual(clinic.relevance, "specialty");
});

test("serves page text only for seeds that have a website", () => {
  assert.ok(fixturePageFor("https://harbourfront-walkin.example"));
  assert.equal(fixturePageFor("https://not-a-fixture.example"), null);
});
