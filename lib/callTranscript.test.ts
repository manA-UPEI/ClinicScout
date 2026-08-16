import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOutcome,
  verifyAgainstTranscript,
} from "./call/verifyTranscript.ts";
import type { CallTurn } from "./call/types.ts";

const TRANSCRIPT: CallTurn[] = [
  { speaker: "clinic", text: "Good afternoon, clinic reception.", atMs: 0 },
  { speaker: "agent", text: "Are you accepting walk-in patients today?", atMs: 1000 },
  { speaker: "clinic", text: "Yes, we're taking walk-ins today until six o'clock.", atMs: 2000 },
  { speaker: "agent", text: "So that would be about a 45 minute wait then?", atMs: 3000 },
  { speaker: "clinic", text: "Mhm.", atMs: 4000 },
];

test("keeps a finding quoted from what the clinic actually said", () => {
  const { findings, rejected } = verifyAgainstTranscript(
    [
      {
        field: "accepts_walk_ins_today",
        value: "Yes",
        quote: "we're taking walk-ins today",
      },
    ],
    TRANSCRIPT
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].value, "Yes");
  assert.equal(findings[0].turnIndex, 2);
  assert.deepEqual(rejected, []);
});

test("rejects a finding quoted from the agent's own words", () => {
  // The whole reason the haystack is clinic-only. The agent supplied "45
  // minute" in a leading question and the clinic merely grunted; quoting the
  // question back would turn the agent's own guess into a confirmed fact.
  const { findings, rejected } = verifyAgainstTranscript(
    [
      {
        field: "current_wait",
        value: "45 minutes",
        quote: "about a 45 minute wait",
      },
    ],
    TRANSCRIPT
  );

  assert.deepEqual(findings, []);
  assert.deepEqual(rejected, ["current_wait"]);
});

test("rejects a fabricated quote", () => {
  const { findings, rejected } = verifyAgainstTranscript(
    [
      {
        field: "current_wait",
        value: "10 minutes",
        quote: "the wait is only ten minutes right now",
      },
    ],
    TRANSCRIPT
  );

  assert.deepEqual(findings, []);
  assert.deepEqual(rejected, ["current_wait"]);
});

test("rejects a paraphrase of something the clinic did say", () => {
  const { findings } = verifyAgainstTranscript(
    [
      {
        field: "accepts_walk_ins_today",
        value: "Yes",
        quote: "we accept walk-in patients until 6pm",
      },
    ],
    TRANSCRIPT
  );

  assert.deepEqual(findings, []);
});

test("tolerates case and whitespace differences from transcription", () => {
  const { findings } = verifyAgainstTranscript(
    [
      {
        field: "accepts_walk_ins_today",
        value: "Yes",
        quote: "TAKING   walk-ins\n today",
      },
    ],
    TRANSCRIPT
  );

  assert.equal(findings.length, 1);
});

test("rejects a quote too short to prove anything", () => {
  const { rejected } = verifyAgainstTranscript(
    [{ field: "current_wait", value: "45 minutes", quote: "Mh" }],
    TRANSCRIPT
  );

  assert.deepEqual(rejected, ["current_wait"]);
});

test("ignores a claim with no value, and its evidence with it", () => {
  const { findings, rejected } = verifyAgainstTranscript(
    [{ field: "current_wait", value: "   ", quote: "we're taking walk-ins today" }],
    TRANSCRIPT
  );

  assert.deepEqual(findings, []);
  assert.deepEqual(rejected, []);
});

test("a second claim for the same field cannot overwrite the first", () => {
  const { findings } = verifyAgainstTranscript(
    [
      {
        field: "accepts_walk_ins_today",
        value: "Yes",
        quote: "we're taking walk-ins today",
      },
      {
        field: "accepts_walk_ins_today",
        value: "No",
        quote: "we're taking walk-ins today",
      },
    ],
    TRANSCRIPT
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].value, "Yes");
});

test("a call that reached nobody yields no findings, whatever was claimed", () => {
  // A voicemail greeting is still words on a transcript. Mining it for facts
  // about walk-in availability would be exactly the wrong behaviour.
  const outcome = buildOutcome(
    "voicemail",
    [
      {
        field: "accepts_walk_ins_today",
        value: "Yes",
        quote: "we're taking walk-ins today",
      },
    ],
    TRANSCRIPT
  );

  assert.equal(outcome.status, "voicemail");
  assert.deepEqual(outcome.findings, []);
  assert.deepEqual(outcome.rejected, []);
});

test("a completed call runs its claims through verification", () => {
  const outcome = buildOutcome(
    "completed",
    [
      {
        field: "accepts_walk_ins_today",
        value: "Yes",
        quote: "we're taking walk-ins today",
      },
      { field: "current_wait", value: "45 minutes", quote: "about a 45 minute wait" },
    ],
    TRANSCRIPT
  );

  assert.deepEqual(
    outcome.findings.map((f) => f.field),
    ["accepts_walk_ins_today"]
  );
  assert.deepEqual(outcome.rejected, ["current_wait"]);
});
