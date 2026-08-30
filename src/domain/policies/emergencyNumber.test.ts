import { test } from "node:test";
import assert from "node:assert/strict";
import { emergencyNumberFor } from "./emergencyNumber.ts";

test("returns the known number for a recognised country", () => {
  assert.equal(emergencyNumberFor("us"), "911");
  assert.equal(emergencyNumberFor("gb"), "999");
  assert.equal(emergencyNumberFor("au"), "000");
  assert.equal(emergencyNumberFor("nz"), "111");
  assert.equal(emergencyNumberFor("de"), "112");
});

test("is case-insensitive, matching how Nominatim casing could vary", () => {
  assert.equal(emergencyNumberFor("US"), "911");
  assert.equal(emergencyNumberFor("De"), "112");
});

test("returns null rather than guessing for an unrecognised or missing country", () => {
  assert.equal(emergencyNumberFor("zz"), null);
  assert.equal(emergencyNumberFor(null), null);
});
