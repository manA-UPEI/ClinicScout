import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureGenerateJson } from "./fixtureJsonExtractionModel.ts";
import { fixturePageFor, CLINIC_SEEDS } from "./fixtureData.ts";
import { verifyAgainstPage } from "../../domain/verification/pageEvidence.ts";
import type { ClinicInspection } from "../../domain/entities/clinic.ts";
import type { ResponseSchema } from "../llm/geminiJsonClient.ts";

const INSPECTION_SCHEMA = {
  type: "OBJECT",
  properties: { accepts_walk_ins: { type: "BOOLEAN" } },
} as unknown as ResponseSchema;

const CALL_SCHEMA = {
  type: "OBJECT",
  properties: { findings: { type: "ARRAY" } },
} as unknown as ResponseSchema;

function inspectionPrompt(clinicName: string, page: string): string {
  return `Clinic name: ${clinicName}\n\n${page}`;
}

/**
 * The test that stops the fixtures rotting: a canned extraction whose quotes
 * drifted out of the canned page would have every field discarded by the
 * verifier and silently render as Unknown, which looks like a broken app
 * rather than a broken fixture.
 */
test("every canned extraction survives the page-evidence firewall", async () => {
  for (const seed of CLINIC_SEEDS) {
    const page = fixturePageFor(seed.tags.website ?? "");
    if (!page) continue;

    const raw = await fixtureGenerateJson<Partial<ClinicInspection>>(
      inspectionPrompt(seed.name, page),
      INSPECTION_SCHEMA
    );
    const verified = verifyAgainstPage(raw!, page);

    assert.ok(
      verified.evidence.length > 0,
      `${seed.name}: no quote survived verification — the fixture page and its extraction have drifted apart`
    );
    for (const entry of verified.evidence) {
      assert.ok(
        page.toLowerCase().includes(entry.quote.toLowerCase()),
        `${seed.name}: quote not present in the fixture page: ${entry.quote}`
      );
    }
  }
});

test("the walk-in clinic's confirmed facts survive verification", async () => {
  const page = fixturePageFor("https://harbourfront-walkin.example")!;
  const raw = await fixtureGenerateJson<Partial<ClinicInspection>>(
    inspectionPrompt("Harbourfront Walk-In Clinic", page),
    INSPECTION_SCHEMA
  );
  const verified = verifyAgainstPage(raw!, page);

  assert.equal(verified.accepts_walk_ins, true);
  assert.equal(verified.appointment_required, false);
  assert.equal(verified.phone, "+1-416-555-0101");
});

test("an unknown clinic name extracts nothing rather than inventing", async () => {
  const raw = await fixtureGenerateJson<Partial<ClinicInspection>>(
    inspectionPrompt("Some Clinic That Is Not A Fixture", "irrelevant page text"),
    INSPECTION_SCHEMA
  );

  assert.deepEqual(raw!.evidence, []);
  assert.equal(raw!.accepts_walk_ins ?? null, null);
});

test("call findings quote the clinic's own transcript lines", async () => {
  const prompt = [
    "ASSISTANT: Do you accept walk-ins today?",
    "CLINIC: Yes, we take walk-ins until six this evening.",
    "CLINIC: The wait is about 40 minutes right now.",
  ].join("\n");

  const result = await fixtureGenerateJson<{
    findings: { field: string; value: string; quote: string }[];
  }>(prompt, CALL_SCHEMA);

  const fields = result!.findings.map((f) => f.field);
  assert.ok(fields.includes("accepts_walk_ins_today"));
  assert.ok(fields.includes("current_wait"));
  for (const finding of result!.findings) {
    assert.ok(
      prompt.includes(finding.quote),
      `quote not found verbatim in the transcript: ${finding.quote}`
    );
  }
});

// The transcript firewall only accepts quotes from clinic turns, so a fixture
// that quoted the assistant would produce zero verified findings.
test("call findings never quote the assistant's own lines", async () => {
  const prompt = [
    "ASSISTANT: I understand the wait is about 90 minutes and you take walk-ins.",
    "CLINIC: I can't say right now.",
  ].join("\n");

  const result = await fixtureGenerateJson<{
    findings: { quote: string }[];
  }>(prompt, CALL_SCHEMA);

  for (const finding of result!.findings) {
    assert.ok(!finding.quote.includes("I understand the wait"));
  }
});
