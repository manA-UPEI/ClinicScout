import { test } from "node:test";
import assert from "node:assert/strict";
import { gateOpeningHoursOsm, verifyAgainstPage } from "./tools/verifyEvidence.ts";

const PAGE =
  "Riverside Walk-In Clinic. Walk-ins are welcome, no appointment needed. " +
  "Call us at 902-555-0142. Current wait is about 30 minutes.";

test("keeps fields whose quote appears verbatim in the page", () => {
  const result = verifyAgainstPage(
    {
      accepts_walk_ins: true,
      phone: "902-555-0142",
      evidence: [
        { field: "accepts_walk_ins", quote: "Walk-ins are welcome" },
        { field: "phone", quote: "Call us at 902-555-0142" },
      ],
    },
    PAGE
  );

  assert.equal(result.accepts_walk_ins, true);
  assert.equal(result.phone, "902-555-0142");
  assert.equal(result.evidence.length, 2);
});

test("discards a field whose quote was fabricated", () => {
  const result = verifyAgainstPage(
    {
      accepts_walk_ins: true,
      current_capacity: "no wait at all",
      evidence: [
        { field: "accepts_walk_ins", quote: "Walk-ins are welcome" },
        { field: "current_capacity", quote: "There is currently no wait at all" },
      ],
    },
    PAGE
  );

  assert.equal(result.accepts_walk_ins, true);
  assert.equal(result.current_capacity, null);
  assert.deepEqual(
    result.evidence.map((e) => e.field),
    ["accepts_walk_ins"]
  );
});

test("discards a field returned with no evidence at all", () => {
  const result = verifyAgainstPage(
    { appointment_required: false, email: "hi@example.com", evidence: [] },
    PAGE
  );

  assert.equal(result.appointment_required, null);
  assert.equal(result.email, null);
});

test("matches across case and whitespace differences from HTML flattening", () => {
  const result = verifyAgainstPage(
    {
      accepts_walk_ins: true,
      evidence: [{ field: "accepts_walk_ins", quote: "walk-ins   are\n Welcome" }],
    },
    PAGE
  );

  assert.equal(result.accepts_walk_ins, true);
});

test("drops evidence cited for a field the model left null", () => {
  const result = verifyAgainstPage(
    {
      accepts_walk_ins: null,
      evidence: [{ field: "accepts_walk_ins", quote: "Walk-ins are welcome" }],
    },
    PAGE
  );

  assert.equal(result.accepts_walk_ins, null);
  assert.equal(result.evidence.length, 0);
});

test("rejects a quote too short to prove anything", () => {
  const result = verifyAgainstPage(
    {
      accepts_walk_ins: true,
      evidence: [{ field: "accepts_walk_ins", quote: "s." }],
    },
    PAGE
  );

  assert.equal(result.accepts_walk_ins, null);
});

test("verifyAgainstPage never trusts opening_hours_osm directly", () => {
  // opening_hours_osm is a derived translation, not a page claim, so quote
  // evidence for it must have no effect — it is gated separately.
  const result = verifyAgainstPage(
    {
      opening_hours: "Mon-Fri 9am-5pm",
      opening_hours_osm: "Mo-Fr 09:00-17:00",
      evidence: [{ field: "opening_hours", quote: "Mon-Fri 9am-5pm" }],
    },
    "Riverside Clinic. Open Mon-Fri 9am-5pm for walk-ins."
  );

  assert.equal(result.opening_hours, "Mon-Fri 9am-5pm");
  assert.equal(result.opening_hours_osm, null);
});

test("gateOpeningHoursOsm trusts a translation only when the source text verified and it parses", () => {
  assert.equal(
    gateOpeningHoursOsm("Mon-Fri 9am-5pm", "Mo-Fr 09:00-17:00"),
    "Mo-Fr 09:00-17:00"
  );
});

test("gateOpeningHoursOsm rejects a translation of text that was never verified", () => {
  // If the raw text itself failed quote verification (fabricated), trusting
  // "its" OSM translation would launder an invented fact into a real verdict.
  assert.equal(gateOpeningHoursOsm(null, "Mo-Fr 09:00-17:00"), null);
});

test("gateOpeningHoursOsm rejects a translation that isn't valid OSM syntax", () => {
  // A model can be confident and still wrong about the grammar; a malformed
  // translation must fail closed to null, not fail open to a guessed verdict.
  assert.equal(gateOpeningHoursOsm("Mon-Fri 9am-5pm", "weekdays, 9 to 5"), null);
});
