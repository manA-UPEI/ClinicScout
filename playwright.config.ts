import { defineConfig, devices } from "@playwright/test";

/**
 * Covers what node --test structurally can't: the actual browser wiring —
 * the SSE stream driving the phase state machine in app/page.tsx. Every test
 * mocks /api/search at the network layer (page.route) rather than hitting
 * Nominatim/Overpass/Gemini for real, for the same reason the unit suite
 * takes callModel/runTool as parameters: no network, no quota burned, no
 * flakiness from a live agent run's timing.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
