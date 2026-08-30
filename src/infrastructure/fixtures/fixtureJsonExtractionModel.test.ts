import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureGenerateJson } from "./fixtureJsonExtractionModel.ts";
import { fixturePageFor, CLINIC_SEEDS } from "./fixtureData.ts";
import { verifyAgainstPage } from "../../domain/verification/pageEvidence.ts";
import type { ClinicInspection } from "../../domain/entities/clinic.ts";

interface RawEntry extends Partial<ClinicInspection> {
  website: string;
}

/** One "=== CLINIC N ===" block, matching what inspectClinicUseCase.ts's buildBatchPrompt sends. */
function clinicBlock(clinicName: string, website: string, page: string): string {
  return `Clinic name: ${clinicName}\nClinic website: ${website}\n\n${page}`;
}

function batchPrompt(...blocks: string[]): string {
  return blocks.join("\n\n");
}

async function inspect(prompt: string): Promise<RawEntry[]> {
  const result = await fixtureGenerateJson<{ clinics: RawEntry[] }>(prompt);
  return result!.clinics;
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

    const [raw] = await inspect(clinicBlock(seed.name, seed.tags.website!, page));
    const verified = verifyAgainstPage(raw, page);

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
  const [raw] = await inspect(
    clinicBlock("Harbourfront Walk-In Clinic", "https://harbourfront-walkin.example", page)
  );
  const verified = verifyAgainstPage(raw, page);

  assert.equal(verified.accepts_walk_ins, true);
  assert.equal(verified.appointment_required, false);
  assert.equal(verified.phone, "+1-416-555-0101");
});

test("an unknown clinic name extracts nothing rather than inventing", async () => {
  const [raw] = await inspect(
    clinicBlock("Some Clinic That Is Not A Fixture", "https://not-a-fixture.example", "irrelevant page text")
  );

  assert.deepEqual(raw.evidence, []);
  assert.equal(raw.accepts_walk_ins ?? null, null);
});

/**
 * The whole point of batching: one prompt carrying several clinics must
 * still resolve each one independently, matched back by website rather than
 * position or name collision.
 */
test("a batch of several clinics extracts each one independently, matched by website", async () => {
  const harbourfrontPage = fixturePageFor("https://harbourfront-walkin.example")!;
  const queenStreetPage = fixturePageFor("https://queenstreet-family.example")!;

  const raws = await inspect(
    batchPrompt(
      clinicBlock("Harbourfront Walk-In Clinic", "https://harbourfront-walkin.example", harbourfrontPage),
      clinicBlock("Queen Street Family Practice", "https://queenstreet-family.example", queenStreetPage)
    )
  );

  assert.equal(raws.length, 2);

  const harbourfront = raws.find((r) => r.website === "https://harbourfront-walkin.example")!;
  const queenStreet = raws.find((r) => r.website === "https://queenstreet-family.example")!;

  assert.equal(verifyAgainstPage(harbourfront, harbourfrontPage).accepts_walk_ins, true);
  assert.equal(verifyAgainstPage(queenStreet, queenStreetPage).appointment_required, true);

  // Cross-checking a clinic's claims against the *other* clinic's page is
  // exactly the failure mode batching must not introduce: nothing genuinely
  // confirmed for one clinic should verify against a page it never came from.
  assert.equal(verifyAgainstPage(harbourfront, queenStreetPage).accepts_walk_ins, null);
});
