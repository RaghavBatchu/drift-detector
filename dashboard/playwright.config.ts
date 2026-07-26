import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for end-to-end tests.
 *
 * Prerequisites
 * ─────────────
 * The test drives a real Next.js app with a real database — the same setup
 * you use for `pnpm dev`.  Before running `pnpm test:e2e`:
 *
 *   1. Make sure your database is reachable (local Postgres or Neon).
 *   2. Run `pnpm dev` in a separate terminal first.
 *      Playwright will reuse that running server rather than spawning a new
 *      child process (which might not inherit your shell's DATABASE_URL /
 *      BETTER_AUTH_SECRET if they live in the shell and not in .env.local).
 *
 * Mock engine
 * ──────────
 * FASTAPI_BASE_URL is deliberately NOT set here.  The scan-engine falls back
 * to runMockFallback automatically — no ai-service needed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  /* Single worker — avoids sign-up / DB collisions across parallel tests. */
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    /* Suppress framer-motion animations so assertions aren't racing them. */
    reducedMotion: "reduce",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    /**
     * Always reuse a running server (locally AND on CI if one was pre-started).
     *
     * Why `true` (not `!process.env.CI`):
     *   A freshly-spawned `pnpm dev` child process inherits only the env vars
     *   that are already exported in the shell that launched `pnpm test:e2e`.
     *   If DATABASE_URL / BETTER_AUTH_SECRET live in the shell but not in a
     *   committed .env.local file, the child starts without them → ECONNREFUSED.
     *   By always reusing an existing server the user started themselves (with
     *   their full environment), we sidestep the env-inheritance problem entirely.
     *
     *   On CI: start the server as a separate step before running Playwright,
     *   e.g.:  `pnpm dev &` then `pnpm test:e2e`.
     */
    reuseExistingServer: true,
    timeout: 60_000,
  },

  /* Mock engine: 4 stages × 4 s ≈ 16 s total.  Give the full flow 90 s. */
  timeout: 90_000,
  expect: {
    /* Give the polling UI extra time to settle before assertions fail. */
    timeout: 30_000,
  },
});
