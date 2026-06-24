import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for VisionQuest.
 *
 * Tests run against a local dev server or the URL specified by BASE_URL.
 * The dev server is started automatically if not already running.
 */
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // PORT is inherited by `next dev`, so BASE_URL + PORT together relocate
    // the whole suite when port 3000 is occupied by something else.
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
