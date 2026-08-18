import { test, expect } from "@playwright/test";
import { sseBody, MOCK_CLINIC } from "./fixtures.ts";

/** Gets to the recommendation view via a mocked search, the shared starting point for every call test. */
async function searchAndReachRecommendation(page: import("@playwright/test").Page) {
  await page.route("**/api/search", async (route) => {
    const body = sseBody([
      // At least one "step" event is required to reach the recommendation:
      // app/page.tsx only sets phase "progress" on a step event, and only
      // AgentProgress's onComplete (fired once `done` is true) advances to
      // "recommendation" -- a result with no preceding step never mounts it.
      { event: "step", data: { id: "search-1", message: "🔍 Found 1 clinic." } },
      {
        event: "result",
        data: {
          steps: [],
          ranked: [MOCK_CLINIC],
          resolvedLocation: "Toronto, Ontario, Canada",
          urgency: "urgent",
          excluded: [],
          mode: "deterministic",
          agentReasoning: null,
        },
      },
    ]);
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });

  await page.goto("/");
  await page.getByPlaceholder("e.g. Charlottetown, PEI").fill("Toronto, Ontario");
  await page.getByRole("button", { name: "Find a clinic" }).click();
  await expect(page.getByRole("heading", { name: "Union Health" })).toBeVisible();
}

test("the consent modal shows the exact script and can be cancelled", async ({ page }) => {
  await searchAndReachRecommendation(page);

  await page
    .getByRole("button", { name: "📞 Have the agent call and ask about walk-ins" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Have the agent call Union Health?" })
  ).toBeVisible();
  // The disclosure and every question are rendered from callScript.ts's
  // buildScript(), so this is the one place a change to the actual script
  // would be caught rather than only asserted against a copy of the text.
  await expect(page.getByText(/I'm an AI, not a person/)).toBeVisible();
  await expect(page.getByText("Are you accepting walk-in patients today?")).toBeVisible();
  await expect(page.getByText("Calling +1-647-498-1421.")).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "📞 Have the agent call and ask about walk-ins" })
  ).toBeVisible();
});

test("approving the call streams a transcript and ends with an outcome", async ({ page }) => {
  await searchAndReachRecommendation(page);

  await page.route("**/api/call", async (route) => {
    const body = sseBody([
      { event: "session", data: { id: "session-1", clinicName: "Union Health" } },
      { event: "status", data: { kind: "status", status: "dialing" } },
      {
        event: "turn",
        data: {
          kind: "turn",
          turn: { speaker: "clinic", text: "Good afternoon, clinic reception.", atMs: 0 },
        },
      },
      { event: "status", data: { kind: "status", status: "in_progress" } },
      {
        event: "turn",
        data: {
          kind: "turn",
          turn: {
            speaker: "agent",
            text: "Are you accepting walk-in patients today?",
            atMs: 900,
          },
        },
      },
      {
        event: "turn",
        data: {
          kind: "turn",
          turn: {
            speaker: "clinic",
            text: "Yes, we're taking walk-ins today until six.",
            atMs: 2000,
          },
        },
      },
      { event: "status", data: { kind: "status", status: "completed" } },
      {
        event: "outcome",
        data: {
          kind: "outcome",
          outcome: {
            status: "completed",
            findings: [
              {
                field: "accepts_walk_ins_today",
                value: "Yes",
                quote: "Yes, we're taking walk-ins today until six.",
                turnIndex: 2,
              },
            ],
            rejected: [],
          },
        },
      },
    ]);
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });

  await page
    .getByRole("button", { name: "📞 Have the agent call and ask about walk-ins" })
    .click();
  await page.getByRole("button", { name: "Approve & place call" }).click();

  // the transcript renders turn by turn, in order, as the mock stream sends them.
  // .first(): the clinic's line also reappears verbatim as the outcome
  // card's quoted evidence below, which is the point being tested next.
  await expect(page.getByText("Good afternoon, clinic reception.")).toBeVisible();
  await expect(
    page.getByText("Yes, we're taking walk-ins today until six.").first()
  ).toBeVisible();

  // STATUS_NOTE["completed"] renders in both CallProgress's status line and
  // CallOutcomeCard's own status line -- .first() picks either legitimately.
  await expect(page.getByText("Call finished.").first()).toBeVisible();

  // The finding itself: label as a <dt> (not free text -- the same words
  // also appear inside the transcript bubble and the quoted evidence below
  // it) with its value as the next sibling <dd>.
  const finding = page.locator("dt", { hasText: "Taking walk-ins today" });
  await expect(finding).toBeVisible();
  await expect(finding.locator("xpath=following-sibling::dd[1]")).toHaveText("Yes");
});
