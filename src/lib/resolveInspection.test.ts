import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInspection } from "./tools/inspectClinic.ts";
import type { ClinicInspection } from "../domain/entities/clinic.ts";

function empty(): ClinicInspection {
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
  };
}

function verified(phone: string): ClinicInspection {
  return { ...empty(), phone, evidence: [{ field: "phone", quote: phone }] };
}

test("a live success is trusted and marked for caching", () => {
  const live = verified("555-0001");
  const { result, shouldCache } = resolveInspection(live, undefined);
  assert.equal(result, live);
  assert.equal(shouldCache, true);
});

test("a failed live attempt falls back to a stale-but-evidenced entry", () => {
  const stale = verified("555-0002");
  const { result, shouldCache } = resolveInspection(empty(), stale);
  assert.equal(result, stale);
  assert.equal(shouldCache, false);
});

test("an empty/failed read with nothing cached returns the empty result, uncached", () => {
  const live = empty();
  const { result, shouldCache } = resolveInspection(live, undefined);
  assert.equal(result, live);
  assert.equal(shouldCache, false);
});

test("a genuine live success always wins over a stale entry, not just when there is none", () => {
  const live = verified("555-0003");
  const stale = verified("555-0002");
  const { result, shouldCache } = resolveInspection(live, stale);
  assert.equal(result, live);
  assert.equal(shouldCache, true);
});
