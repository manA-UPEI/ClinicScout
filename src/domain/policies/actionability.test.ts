import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasContactChannel,
  isDeadEnd,
  isLocatable,
} from "./actionability.ts";
import type { Clinic } from "../entities/clinic.ts";

function clinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    clinic_name: "Test Clinic",
    address: null,
    distance_km: 1,
    phone: null,
    email: null,
    website: null,
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

test("any single contact channel counts as reachable", () => {
  assert.equal(hasContactChannel(clinic({ phone: "902-555-0142" })), true);
  assert.equal(hasContactChannel(clinic({ email: "hi@example.org" })), true);
  assert.equal(
    hasContactChannel(clinic({ booking_url: "https://example.org/book" })),
    true
  );
  assert.equal(hasContactChannel(clinic()), false);
});

test("a website alone is not a way to reach the clinic", () => {
  // You cannot book or ask a question through a URL we merely know exists.
  assert.equal(hasContactChannel(clinic({ website: "https://example.org" })), false);
});

test("missing only one of contact or address is not a dead end", () => {
  assert.equal(isDeadEnd(clinic({ address: "12 Main St" })), false);
  assert.equal(isDeadEnd(clinic({ phone: "902-555-0142" })), false);
  assert.equal(isLocatable(clinic({ address: "12 Main St" })), true);
});

test("no contact and no address is a dead end", () => {
  assert.equal(isDeadEnd(clinic()), true);
});
