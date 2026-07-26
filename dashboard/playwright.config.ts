import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for end-to-end tests.
 *
 * Deliberately does NOT set FASTAPI_BASE_URL so the test always runs
 * against the mock fallback engine — no external ai-service dependency.
 *
 * The webServer block boots the Next.js dev server automatically; tests
 * wait for it to become ready before the first spec runs.
 */
export default defineConfig({
  testDir: "./e2e",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,
  /* Single worker to avoid parallel login collisions on the same DB */
  workers: 1,
  /* Reporter */
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    /* Collect trace on first retry to aid debugging */
    trace: "on-first-retry",
    /* Disable browser animations so assertions aren't racing against
       framer-motion transitions */
    reducedMotion: "reduce",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Boot the Next.js dev server before the test suite starts.
   * The mock engine is used automatically because FASTAPI_BASE_URL is not set. */
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    /* Give Next.js up to 60 s to compile on first start */
    timeout: 60_000,
  },

  /* The mock scan engine takes 4 stages × 4 s = 16 s; give the full flow
   * plenty of room (60 s total for the scan + 10 s page interactions). */
  timeout: 90_000,
  expect: {
    /* Longer default assertion timeout to handle polling UI */
    timeout: 30_000,
  },
});
