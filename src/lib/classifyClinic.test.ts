import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyClinic } from "../domain/policies/classifyClinic.ts";

// The real listings that Stage 3 verification wrongly surfaced as walk-in
// options near Toronto, Kitchener and Halifax.
const REAL_SPECIALTY_LISTINGS = [
  "Trio Fertility",
  "LASIK MD",
  "Acupuncture Toronto - ALIVE Holistic Health & Fertility Clinic",
  "ABA Compass Behavior Therapy Services Inc.",
  "Optometrists - Dr. Valerie Dippel & Dr. Dawn Clarke",
  "Orthopedic Assessment Clinic",
  "Non Invasive Vascular Lab Testing",
];

test("excludes the specialty listings that polluted earlier results", () => {
  for (const name of REAL_SPECIALTY_LISTINGS) {
    const result = classifyClinic(name, {});
    assert.equal(result.relevance, "specialty", `${name} should be specialty`);
    assert.ok(result.specialty, `${name} should carry a specialty label`);
  }
});

test("keeps walk-in and general practice listings", () => {
  const keep = [
    "Riverside Walk-In Clinic",
    "Downtown Urgent Care",
    "Appletree Medical Centre",
    "North End Community Health Centre",
    "Maple Street Family Practice",
  ];
  for (const name of keep) {
    const result = classifyClinic(name, {});
    assert.notEqual(result.relevance, "specialty", `${name} should not be excluded`);
  }
});

// "Walk-in" is an access mode, not a scope of care — a walk-in eye clinic
// still cannot treat a sore throat, so specialty has to win.
test("a specialty name beats a walk-in name", () => {
  const eye = classifyClinic("Eye Care Walk-In Clinic", {});
  assert.equal(eye.relevance, "specialty");
  assert.equal(eye.specialty, "Eye care");

  const pain = classifyClinic("Pain Releif Walkin-in Clinic", {});
  assert.equal(pain.relevance, "specialty");
});

test("a plain walk-in listing is still the top tier", () => {
  assert.equal(classifyClinic("Downtown Walk-In Clinic", {}).relevance, "walk_in");
  assert.equal(classifyClinic("K-W Urgent Care Clinic", {}).relevance, "walk_in");
});

test("leaves an unrecognised listing eligible rather than guessing", () => {
  const result = classifyClinic("Dr. Mary Wong", {});
  assert.equal(result.relevance, "unknown");
  assert.equal(result.specialty, null);
});

test("uses OSM healthcare tags ahead of the name", () => {
  const result = classifyClinic("Bright Futures", { healthcare: "physiotherapist" });
  assert.equal(result.relevance, "specialty");
  assert.equal(result.specialty, "Physical & alternative therapy");
});

test("treats general and paediatric specialities as eligible", () => {
  for (const speciality of ["general", "paediatrics", "general;geriatrics"]) {
    const result = classifyClinic("Somewhere Clinic", {
      "healthcare:speciality": speciality,
    });
    assert.equal(result.relevance, "general", speciality);
  }
});

test("excludes a listing whose only signal is a specialist speciality tag", () => {
  const result = classifyClinic("Somewhere Clinic", {
    "healthcare:speciality": "ophthalmology",
  });
  assert.equal(result.relevance, "specialty");
  assert.equal(result.specialty, "Eye care");
});
