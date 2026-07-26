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
    // Wait for the Suspense boundary (useSearchParams) to resolve
    await page.waitForLoadState("networkidle");

    // CardTitle renders as a <div> (not a semantic heading), so we use
    // getByText rather than getByRole("heading") here and throughout the flow.
    await expect(page.getByText("Create an account").first()).toBeVisible();

    // Fill in the registration form
    await page.getByPlaceholder("John Doe").fill(name);
    await page.getByPlaceholder("name@example.com").fill(email);
    await page.getByPlaceholder("••••••••").fill(password);

    // Submit and wait for redirect back to "/"
    await page.getByRole("button", { name: "Sign Up" }).click();

    // After sign-up the app redirects to "/" (the scanner form for authed users)
    await page.waitForURL("/", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    // -----------------------------------------------------------------------
    // Step 2: Add a repository
    //   The homepage shows "Initiate Security Scan" (via CardTitle → <div>)
    //   when the user is logged in.
    //   We use the "try the demo repo" shortcut to fill the URL, then submit.
    // -----------------------------------------------------------------------
    await expect(page.getByText("Initiate Security Scan").first()).toBeVisible();

    // Click the demo repo shortcut — this fills the URL input without typing
    await page.getByText("try the demo repo").click();

    // Confirm the input now contains the demo URL
    const repoInput = page.getByPlaceholder("https://github.com/user/repo");
    await expect(repoInput).toHaveValue(DEMO_REPO_URL);

    // Submit the form
    await page.getByRole("button", { name: "Start Scan" }).click();

    // -----------------------------------------------------------------------
    // Step 3: Wait for ScanProgress to reach a finished state
    //   The component shows "Scan Completed! Redirecting to report..." on
    //   success and then navigates to /repos/:id automatically after 1 s.
    //
    //   Timeout: 60 s — the mock engine takes ~16 s, plus polling overhead.
    // -----------------------------------------------------------------------

    // The ScanProgress card should appear while the scan is in-flight
    await expect(
      page.getByText("Drift Analysis in Progress")
    ).toBeVisible({ timeout: 10_000 });

    // Wait for the scan to finish and auto-navigation to the report page.
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

    // "Fired Findings" is a real <h2> inside FindingsTable — use h2 locator
    await expect(
      page.locator("h2").filter({ hasText: "Fired Findings" })
    ).toBeVisible({ timeout: 15_000 });

    // At least one severity badge must be visible.
    // SeverityBadge renders "Critical", "High", "Medium", or "Low" as
    // uppercase text in a <span> with tracked-wider styling.
    const severityBadge = page
      .locator("span")
      .filter({ hasText: /^(Critical|High|Medium|Low)$/ })
      .first();

    await expect(severityBadge).toBeVisible({ timeout: 15_000 });

    // Verify the summary card is rendered (CardTitle → <div>, use getByText)
    await expect(page.getByText("Critical & High Findings")).toBeVisible();

    // Verify at least one finding row shows a commit hash
    await expect(page.getByText(/Commit:/).first()).toBeVisible();
  });
});
