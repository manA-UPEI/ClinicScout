import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureGenerateJson } from "./fixtureJsonExtractionModel.ts";
import { fixturePageFor, CLINIC_SEEDS } from "./fixtureData.ts";
import { verifyAgainstPage } from "../../domain/verification/pageEvidence.ts";
import type { ClinicInspection } from "../../domain/entities/clinic.ts";

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
      inspectionPrompt(seed.name, page)
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
    inspectionPrompt("Harbourfront Walk-In Clinic", page)
  );
  const verified = verifyAgainstPage(raw!, page);

  assert.equal(verified.accepts_walk_ins, true);
  assert.equal(verified.appointment_required, false);
  assert.equal(verified.phone, "+1-416-555-0101");
});

test("an unknown clinic name extracts nothing rather than inventing", async () => {
  const raw = await fixtureGenerateJson<Partial<ClinicInspection>>(
    inspectionPrompt("Some Clinic That Is Not A Fixture", "irrelevant page text")
  );

  assert.deepEqual(raw!.evidence, []);
  assert.equal(raw!.accepts_walk_ins ?? null, null);
});
