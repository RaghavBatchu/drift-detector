/**
 * E2E: full user-flow test — sign-up → add repo → scan → drift report
 *
 * Runs against the mock fallback engine (FASTAPI_BASE_URL is deliberately
 * unset in playwright.config.ts) so the test is:
 *   - Fast: no ai-service dependency
 *   - Hermetic: every run creates a unique email to avoid DB collisions
 *   - Reliable: polls the ScanProgress component rather than sleeping
 *
 * Timing budget:
 *   - Mock engine: 4 stages × 4 s delay = ~16 s to reach "completed"
 *   - ScanProgress polls every 1.5 s, so it catches the transition quickly
 *   - Total test timeout: 90 s (set in playwright.config.ts)
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique test email on every run so parallel or repeated runs
 * never collide on the same user account in the database.
 */
function uniqueEmail(): string {
  return `test-${Date.now()}@playwright.local`;
}

// The demo repo URL — the mock engine clones all 10 seeded findings for this URL.
const DEMO_REPO_URL = "https://github.com/acme/payments-infra";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Scan flow — mock engine, zero external dependencies", () => {
  test("sign up → submit demo repo → wait for completed scan → see findings with severity badges", async ({
    page,
  }) => {
    const email = uniqueEmail();
    const password = "testpassword123";
    const name = "Playwright Tester";

    // -----------------------------------------------------------------------
    // Step 1: Sign up a new test user
    // -----------------------------------------------------------------------
    await page.goto("/sign-up");

    // Confirm we're on the sign-up page
    await expect(
      page.getByRole("heading", { name: "Create an account" })
    ).toBeVisible();

    // Fill in the registration form
    await page.getByPlaceholder("John Doe").fill(name);
    await page.getByPlaceholder("name@example.com").fill(email);
    await page.getByPlaceholder("••••••••").fill(password);

    // Submit and wait for redirect back to "/"
    await page.getByRole("button", { name: "Sign Up" }).click();

    // After sign-up the app redirects to "/" (the scanner form for authed users)
    await page.waitForURL("/", { timeout: 15_000 });

    // -----------------------------------------------------------------------
    // Step 2: Add a repository
    //   The homepage shows "Initiate Security Scan" when the user is logged in.
    //   We use the "try the demo repo" shortcut to fill the URL, then submit.
    // -----------------------------------------------------------------------
    await expect(
      page.getByRole("heading", { name: "Initiate Security Scan" })
    ).toBeVisible();

    // Click the demo repo shortcut — this fills the URL input without typing
    await page.getByText("try the demo repo").click();

    // Confirm the input now contains the demo URL
    const repoInput = page.getByPlaceholder(
      "https://github.com/user/repo"
    );
    await expect(repoInput).toHaveValue(DEMO_REPO_URL);

    // Submit the form
    await page.getByRole("button", { name: "Start Scan" }).click();

    // -----------------------------------------------------------------------
    // Step 3: Wait for ScanProgress to reach a finished state
    //   The component shows "Scan Completed! Redirecting to report..." on
    //   success and then navigates to /repos/:id automatically after 1 s.
    //   We poll for either the completion text or the repo detail page URL.
    //
    //   Timeout: 60 s — the mock engine takes ~16 s, plus polling overhead.
    // -----------------------------------------------------------------------

    // The ScanProgress card should appear while the scan is in-flight
    await expect(
      page.getByText("Drift Analysis in Progress")
    ).toBeVisible({ timeout: 10_000 });

    // Wait for the scan to finish — either "completed" message or navigation
    // to the report page.  We wait for the URL to change to /repos/<id>.
    await page.waitForURL(/\/repos\/[^/]+$/, { timeout: 60_000 });

    // -----------------------------------------------------------------------
    // Step 4: Assert the Drift Report screen renders ≥1 finding with a visible
    //   severity badge.
    //
    //   SeverityBadge renders one of: Critical / High / Medium / Low
    //   FindingsTable renders them inside a card with the badge as the first
    //   visible element per row.
    // -----------------------------------------------------------------------

    // Confirm we landed on a repo detail page
    expect(page.url()).toMatch(/\/repos\/[^/]+$/);

    // The findings section heading
    await expect(page.getByRole("heading", { name: "Fired Findings" })).toBeVisible(
      { timeout: 15_000 }
    );

    // At least one severity badge must be visible.
    // SeverityBadge renders the text "Critical", "High", "Medium", or "Low"
    // in an uppercase tracking-wider span.  We query by any of the four labels.
    const severityBadge = page
      .locator("span")
      .filter({
        hasText: /^(Critical|High|Medium|Low)$/,
      })
      .first();

    await expect(severityBadge).toBeVisible({ timeout: 15_000 });

    // Bonus: verify the summary card "Critical & High Findings" is rendered
    // (this confirms the full report layout loaded, not just a stub)
    await expect(
      page.getByText("Critical & High Findings")
    ).toBeVisible();

    // Verify at least one finding row is present in the table (the card rows
    // each have a commit hash displayed)
    await expect(page.getByText(/Commit:/)).toBeVisible();
  });
});
