import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenNow, isValidOpeningHours } from "../domain/policies/openingHours.ts";

const WED_1030 = new Date(2026, 7, 12, 10, 30);
const WED_1230 = new Date(2026, 7, 12, 12, 30);
const WED_1400 = new Date(2026, 7, 12, 14, 0);
const WED_2000 = new Date(2026, 7, 12, 20, 0);
const TUE_1030 = new Date(2026, 7, 11, 10, 30);
const SUN_1030 = new Date(2026, 7, 16, 10, 30);
const SUN_1600 = new Date(2026, 7, 16, 16, 0);

const cases: [string | null, Date, boolean | null][] = [
  ["24/7", WED_1030, true],
  ["Mo-Fr 08:00-16:00; Sa-Su off", WED_1030, true],
  ["Mo-Fr 08:00-16:00; Sa-Su off", WED_2000, false],
  ["Mo-Fr 08:00-16:00; Sa-Su off", SUN_1030, false],
  ["Mo-Fr 09:00-12:00,13:00-17:00", WED_1030, true],
  ["Mo-Fr 09:00-12:00,13:00-17:00", WED_1230, false],
  ["Mo-Fr 09:00-12:00,13:00-17:00", WED_1400, true],
  ["Mo,We,Fr 09:00-12:00", WED_1030, true],
  ["Mo,We,Fr 09:00-12:00", TUE_1030, false],
  // A later rule overrides an earlier one for the same day.
  ["Mo-Fr 09:00-17:00; We off", WED_1030, false],
  ["Sa-Su 10:00-14:00", SUN_1030, true],
  ["Mo-Fr 08:00-16:00", SUN_1030, false],
  // Day ranges may wrap around the end of the week.
  ["Fr-Mo 09:00-17:00", SUN_1030, true],
  // Comma-separated rules appear on real OSM entries.
  ["Mo-Fr 08:00-20:00, Sa 10:00-16:00, Su 09:00-15:00", WED_1030, true],
  ["Mo-Fr 08:00-20:00, Sa 10:00-16:00, Su 09:00-15:00", SUN_1030, true],
  ["Mo-Fr 08:00-20:00, Sa 10:00-16:00, Su 09:00-15:00", SUN_1600, false],
  ["Mo-Fr 08:00-20:00, Sa 10:00-16:00", SUN_1030, false],
];

// Syntax we cannot evaluate must return null. A wrong "Open now" sends someone
// who may be unwell to a closed clinic, so silence beats a guess.
const mustNotGuess: (string | null)[] = [
  "Mo-Fr 08:00-16:00; PH off",
  "sunrise-sunset",
  "Mo-Fr 08:00+",
  "Jan-Mar 09:00-17:00",
  "by appointment",
  "",
  null,
  "Mo-Fr",
  "garbage value",
  "Mo-Fr 25:00-99:00",
];

test("evaluates supported opening_hours formats", () => {
  for (const [tag, when, expected] of cases) {
    assert.equal(isOpenNow(tag, when), expected, `${tag} @ ${when.toISOString()}`);
  }
});

test("returns null rather than guessing on unsupported syntax", () => {
  for (const tag of mustNotGuess) {
    assert.equal(isOpenNow(tag, WED_1030), null, `expected null for ${tag}`);
  }
});

// isValidOpeningHours gates Gemini's free-text-to-OSM-syntax translations
// (see gateOpeningHoursOsm) — it must accept exactly what isOpenNow can
// evaluate, and reject exactly what isOpenNow would silently return null for.
test("isValidOpeningHours agrees with what isOpenNow can actually evaluate", () => {
  for (const [tag] of cases) {
    assert.equal(isValidOpeningHours(tag), true, `expected valid: ${tag}`);
  }
  for (const tag of mustNotGuess) {
    assert.equal(isValidOpeningHours(tag), false, `expected invalid: ${tag}`);
  }
});
