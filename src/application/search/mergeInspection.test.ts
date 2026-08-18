import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeInspection } from "./inspectClinicUseCase.ts";
import type { Clinic, ClinicInspection } from "../../domain/entities/clinic.ts";

function clinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    clinic_name: "Test Clinic",
    address: null,
    distance_km: 1,
    phone: null,
    email: null,
    website: "https://example.org",
    source_url: "https://example.org/1",
    opening_hours: null,
    open_now: null,
    current_capacity: null,
    accepts_walk_ins: null,
    appointment_required: null,
    booking_url: null,
    email_booking_supported: null,
    confidence: "Low",
    relevance: "unknown",
    specialty: null,
    evidence: [],
    ...overrides,
  };
}

function inspection(overrides: Partial<ClinicInspection> = {}): ClinicInspection {
  return {
    current_capacity: null,
    accepts_walk_ins: null,
    appointment_required: null,
    booking_url: null,
    email: null,
    email_booking_supported: null,
    phone: null,
    opening_hours: null,
    opening_hours_osm: null,
    evidence: [],
    ...overrides,
  };
}

test("a gated OSM hours string recomputes open_now for the merged clinic", () => {
  const merged = mergeInspection(
    clinic({ open_now: null }),
    inspection({
      opening_hours: "Open 24 hours",
      opening_hours_osm: "24/7",
      evidence: [{ field: "opening_hours", quote: "Open 24 hours" }],
    })
  );
  assert.equal(merged.open_now, true);
  assert.equal(merged.opening_hours, "Open 24 hours");
});

test("a real 'confirmed closed' verdict is preserved, not treated as absent", () => {
  // isOpenNow can legitimately return false; merge must use ?? (nullish),
  // not || , or a correct "closed" verdict would be discarded as falsy.
  // "Mo-Su off" is closed on every day of the week, so this is false
  // regardless of what day or time the suite actually runs (mergeInspection
  // calls isOpenNow with the real clock and has no injectable "now").
  const merged = mergeInspection(
    clinic({ open_now: null }),
    inspection({
      opening_hours: "Mo-Su off",
      opening_hours_osm: "Mo-Su off",
      evidence: [{ field: "opening_hours", quote: "Mo-Su off" }],
    })
  );
  assert.equal(merged.open_now, false);
});

test("no opening_hours_osm leaves the clinic's existing open_now untouched", () => {
  const merged = mergeInspection(clinic({ open_now: true }), inspection());
  assert.equal(merged.open_now, true);
});

test("a null opening_hours_osm (gated out upstream) falls back to the existing verdict", () => {
  const merged = mergeInspection(
    clinic({ open_now: false }),
    inspection({ opening_hours_osm: null })
  );
  assert.equal(merged.open_now, false);
});

test("inspection fields overwrite OSM fields only when non-null", () => {
  const merged = mergeInspection(
    clinic({ phone: "555-0001", email: null, current_capacity: "busy" }),
    inspection({ phone: "555-0002", email: "hi@example.org", current_capacity: null })
  );
  assert.equal(merged.phone, "555-0002");
  assert.equal(merged.email, "hi@example.org");
  // Inspection said nothing about capacity, so the OSM-sourced value survives.
  assert.equal(merged.current_capacity, "busy");
});

test("confidence is promoted to High only when the site yielded verified evidence", () => {
  const withEvidence = mergeInspection(
    clinic({ confidence: "Low" }),
    inspection({ phone: "555-0002", evidence: [{ field: "phone", quote: "555-0002" }] })
  );
  assert.equal(withEvidence.confidence, "High");

  const withoutEvidence = mergeInspection(clinic({ confidence: "Medium" }), inspection());
  assert.equal(withoutEvidence.confidence, "Medium");
});
