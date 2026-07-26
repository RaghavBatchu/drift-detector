import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { resolve } from "path";

/**
 * Load .env.local into the Playwright runner's process.env so the vars
 * can be forwarded into the Next.js dev-server child process (see webServer.env
 * below).  This is a no-op when the vars are already in the shell environment.
 *
 * Next.js reads .env.local on its own when it starts — but only if NEXT.JS
 * starts the process itself.  When PLAYWRIGHT spawns `pnpm dev`, the child
 * inherits process.env from Playwright, NOT from a fresh shell, so Next.js's
 * own .env.local loading may or may not cover the gap depending on timing.
 * Explicitly forwarding via `webServer.env` is the guaranteed path.
 */
loadDotenv({ path: resolve(__dirname, ".env.local"), override: false });

/**
 * Playwright configuration for end-to-end tests.
 *
 * Prerequisites (one-time setup)
 * ──────────────────────────────
 * Create dashboard/.env.local with at minimum:
 *
 *   DATABASE_URL="postgresql://..."   # same value you use for pnpm dev
 *   BETTER_AUTH_SECRET="..."
 *   BETTER_AUTH_URL="http://localhost:3000"
 *
 * After that, `pnpm test:e2e` is self-contained — Playwright boots the dev
 * server itself, reads those vars, and tears it down when done.
 *
 * Mock engine
 * ───────────
 * FASTAPI_BASE_URL is intentionally NOT set → the scan-engine falls back to
 * runMockFallback automatically.  No ai-service process needed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  /* Single worker — one sign-up at a time avoids DB row conflicts. */
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
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
    /* Locally: reuse an already-running dev server if present (fast iteration).
       On CI: always start a fresh one. */
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    /**
     * Explicitly forward the env vars that the Next.js server needs.
     * These come from process.env, which was populated above either by
     * loadDotenv (if .env.local exists) or by the user's shell exports.
     *
     * Without this, a freshly-spawned `pnpm dev` child may not see the vars
     * if they came from .env.local rather than the shell — because Next.js
     * reads .env.local AFTER its process starts, but the pg.Pool and Better
     * Auth are initialised at import time from the already-set environment.
     */
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
      BETTER_AUTH_URL:
        process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      FASTAPI_BASE_URL: process.env.FASTAPI_BASE_URL ?? "",
    },
  },

  /* Mock engine: 4 stages × 4 s ≈ 16 s.  Give the full flow 90 s. */
  timeout: 90_000,
  expect: {
    /* Extra headroom for the polling UI to settle. */
    timeout: 30_000,
  },
});

