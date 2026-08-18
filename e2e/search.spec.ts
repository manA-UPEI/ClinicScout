import { test, expect } from "@playwright/test";
import { sseBody, MOCK_CLINIC } from "./fixtures.ts";

test("the emergency and privacy disclaimer is visible before any search runs", async ({
  page,
}) => {
  // The point of making this persistent (components/Footer.tsx) rather than
  // conditional on a finished search: someone typing during an actual
  // emergency needs to see it before a 40s-budgeted run ever completes.
  await page.goto("/");
  await expect(page.getByText(/If this could be an emergency, call 911/)).toBeVisible();
  await expect(page.getByText(/Your typed location is used only to run this search/)).toBeVisible();
});

test("a search streams progress, then renders a recommendation with a working action", async ({
  page,
}) => {
  await page.route("**/api/search", async (route) => {
    const body = sseBody([
      { event: "step", data: { id: "geocode", message: "📍 Resolved location." } },
      { event: "step", data: { id: "search-5", message: "🔍 Found 1 clinic." } },
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

  // progress phase: steps stream in before the run completes
  await expect(page.getByText("📍 Resolved location.")).toBeVisible();
  await expect(page.getByText("🔍 Found 1 clinic.")).toBeVisible();

  // recommendation phase, reached automatically once the result event lands
  await expect(page.getByRole("heading", { name: "Union Health" })).toBeVisible();
  await expect(page.getByText("Results near Toronto, Ontario, Canada")).toBeVisible();

  // determineAction("call_only") for a clinic with a phone but no email/booking_url
  await expect(page.getByRole("link", { name: /Call Clinic:/ })).toHaveAttribute(
    "href",
    "tel:+1-647-498-1421"
  );

  // the call-consent flow is offered alongside the primary action
  await expect(
    page.getByRole("button", { name: "📞 Have the agent call and ask about walk-ins" })
  ).toBeVisible();
});

test("an agent-run failure renders the error phase with a request reference", async ({
  page,
}) => {
  await page.route("**/api/search", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          kind: "location_not_found",
          message: "Could not resolve that location.",
          requestId: "e2e12345",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("e.g. Charlottetown, PEI").fill("Nowhere at all");
  await page.getByRole("button", { name: "Find a clinic" }).click();

  await expect(page.getByRole("heading", { name: "We couldn't find that location" })).toBeVisible();
  await expect(page.getByText("Could not resolve that location.")).toBeVisible();
  await expect(page.getByText("Reference: e2e12345")).toBeVisible();

  // retrying returns to the input phase rather than leaving the user stuck
  await page.getByRole("button", { name: "Try another search" }).click();
  await expect(page.getByRole("heading", { name: "ClinicScout AI" })).toBeVisible();
});

test("the rate-limited path shows its own heading, not a generic error", async ({ page }) => {
  await page.route("**/api/search", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "600" },
      body: JSON.stringify({
        error: {
          kind: "rate_limited",
          message: "You've made a lot of searches in a short time. Please wait a bit and try again.",
          requestId: "e2e67890",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("e.g. Charlottetown, PEI").fill("Toronto, Ontario");
  await page.getByRole("button", { name: "Find a clinic" }).click();

  await expect(page.getByRole("heading", { name: "Too many searches" })).toBeVisible();
  await expect(page.getByText("Reference: e2e67890")).toBeVisible();
});
