import { test } from "node:test";
import assert from "node:assert/strict";
import { draft_clinic_issue_report } from "./reportClinicIssue.ts";

test("names the clinic and links its source in both the subject and body", () => {
  const report = draft_clinic_issue_report(
    "Harbourfront Walk-In Clinic",
    "https://www.openstreetmap.org/node/123"
  );

  assert.match(report.subject, /Harbourfront Walk-In Clinic/);
  assert.match(report.body, /Harbourfront Walk-In Clinic/);
  assert.match(report.body, /https:\/\/www\.openstreetmap\.org\/node\/123/);
});
