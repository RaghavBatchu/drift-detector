# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scan-flow.spec.ts >> Scan flow — mock engine, zero external dependencies >> sign up → submit demo repo → wait for completed scan → see findings with severity badges
- Location: e2e/scan-flow.spec.ts:38:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation to "/" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - generic [ref=e3]:
      - link "DriftGuard" [ref=e4] [cursor=pointer]:
        - /url: /
      - navigation [ref=e9]:
        - link "Dashboard" [ref=e10] [cursor=pointer]:
          - /url: /
        - link "Repositories" [ref=e11] [cursor=pointer]:
          - /url: /repos
        - link "API Docs" [ref=e12] [cursor=pointer]:
          - /url: /api-docs
      - generic [ref=e13]:
        - button "Toggle theme" [ref=e14] [cursor=pointer]
        - link [ref=e17] [cursor=pointer]:
          - /url: /sign-in
          - button "Sign in" [ref=e18]
  - main [ref=e19]:
    - generic [ref=e21]:
      - generic [ref=e22]:
        - generic [ref=e23]: Create an account
        - generic [ref=e24]: Enter your details below to register your DriftGuard account
      - generic [ref=e26]:
        - generic [ref=e27]: Failed to create account.
        - generic [ref=e28]:
          - generic [ref=e29]: Full Name
          - textbox "John Doe" [ref=e34]: Playwright Tester
        - generic [ref=e35]:
          - generic [ref=e36]: Email Address
          - textbox "name@example.com" [ref=e41]: test-1785063321811@playwright.local
        - generic [ref=e42]:
          - generic [ref=e43]: Password
          - textbox "••••••••" [ref=e48]: testpassword123
        - button "Sign Up" [ref=e49] [cursor=pointer]
      - paragraph [ref=e51]:
        - text: Already have an account?
        - link "Sign in" [ref=e52] [cursor=pointer]:
          - /url: /sign-in
  - contentinfo [ref=e53]:
    - generic [ref=e54]:
      - paragraph [ref=e55]: © 2026 DriftGuard. All rights reserved.
      - generic [ref=e56]:
        - link "Privacy Policy" [ref=e57] [cursor=pointer]:
          - /url: "#"
        - link "Terms of Service" [ref=e58] [cursor=pointer]:
          - /url: "#"
  - button "Open Next.js Dev Tools" [ref=e64] [cursor=pointer]
  - alert [ref=e68]
```

# Test source

```ts
  1   | /**
  2   |  * E2E: full user-flow test — sign-up → add repo → scan → drift report
  3   |  *
  4   |  * Runs against the mock fallback engine (FASTAPI_BASE_URL is deliberately
  5   |  * unset in playwright.config.ts) so the test is:
  6   |  *   - Fast: no ai-service dependency
  7   |  *   - Hermetic: every run creates a unique email to avoid DB collisions
  8   |  *   - Reliable: polls the ScanProgress component rather than sleeping
  9   |  *
  10  |  * Timing budget:
  11  |  *   - Mock engine: 4 stages × 4 s delay = ~16 s to reach "completed"
  12  |  *   - ScanProgress polls every 1.5 s, so it catches the transition quickly
  13  |  *   - Total test timeout: 90 s (set in playwright.config.ts)
  14  |  */
  15  | 
  16  | import { test, expect } from "@playwright/test";
  17  | 
  18  | // ---------------------------------------------------------------------------
  19  | // Helpers
  20  | // ---------------------------------------------------------------------------
  21  | 
  22  | /**
  23  |  * Generate a unique test email on every run so parallel or repeated runs
  24  |  * never collide on the same user account in the database.
  25  |  */
  26  | function uniqueEmail(): string {
  27  |   return `test-${Date.now()}@playwright.local`;
  28  | }
  29  | 
  30  | // The demo repo URL — the mock engine clones all 10 seeded findings for this URL.
  31  | const DEMO_REPO_URL = "https://github.com/acme/payments-infra";
  32  | 
  33  | // ---------------------------------------------------------------------------
  34  | // Test suite
  35  | // ---------------------------------------------------------------------------
  36  | 
  37  | test.describe("Scan flow — mock engine, zero external dependencies", () => {
  38  |   test("sign up → submit demo repo → wait for completed scan → see findings with severity badges", async ({
  39  |     page,
  40  |   }) => {
  41  |     const email = uniqueEmail();
  42  |     const password = "testpassword123";
  43  |     const name = "Playwright Tester";
  44  | 
  45  |     // -----------------------------------------------------------------------
  46  |     // Step 1: Sign up a new test user
  47  |     // -----------------------------------------------------------------------
  48  |     await page.goto("/sign-up");
  49  |     // Wait for the Suspense boundary (useSearchParams) to resolve
  50  |     await page.waitForLoadState("networkidle");
  51  | 
  52  |     // CardTitle renders as a <div> (not a semantic heading), so we use
  53  |     // getByText rather than getByRole("heading") here and throughout the flow.
  54  |     await expect(page.getByText("Create an account").first()).toBeVisible();
  55  | 
  56  |     // Fill in the registration form
  57  |     await page.getByPlaceholder("John Doe").fill(name);
  58  |     await page.getByPlaceholder("name@example.com").fill(email);
  59  |     await page.getByPlaceholder("••••••••").fill(password);
  60  | 
  61  |     // Submit and wait for redirect back to "/"
  62  |     await page.getByRole("button", { name: "Sign Up" }).click();
  63  | 
  64  |     // After sign-up the app redirects to "/" (the scanner form for authed users)
> 65  |     await page.waitForURL("/", { timeout: 15_000 });
      |                ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  66  |     await page.waitForLoadState("networkidle");
  67  | 
  68  |     // -----------------------------------------------------------------------
  69  |     // Step 2: Add a repository
  70  |     //   The homepage shows "Initiate Security Scan" (via CardTitle → <div>)
  71  |     //   when the user is logged in.
  72  |     //   We use the "try the demo repo" shortcut to fill the URL, then submit.
  73  |     // -----------------------------------------------------------------------
  74  |     await expect(page.getByText("Initiate Security Scan").first()).toBeVisible();
  75  | 
  76  |     // Click the demo repo shortcut — this fills the URL input without typing
  77  |     await page.getByText("try the demo repo").click();
  78  | 
  79  |     // Confirm the input now contains the demo URL
  80  |     const repoInput = page.getByPlaceholder("https://github.com/user/repo");
  81  |     await expect(repoInput).toHaveValue(DEMO_REPO_URL);
  82  | 
  83  |     // Submit the form
  84  |     await page.getByRole("button", { name: "Start Scan" }).click();
  85  | 
  86  |     // -----------------------------------------------------------------------
  87  |     // Step 3: Wait for ScanProgress to reach a finished state
  88  |     //   The component shows "Scan Completed! Redirecting to report..." on
  89  |     //   success and then navigates to /repos/:id automatically after 1 s.
  90  |     //
  91  |     //   Timeout: 60 s — the mock engine takes ~16 s, plus polling overhead.
  92  |     // -----------------------------------------------------------------------
  93  | 
  94  |     // The ScanProgress card should appear while the scan is in-flight
  95  |     await expect(
  96  |       page.getByText("Drift Analysis in Progress")
  97  |     ).toBeVisible({ timeout: 10_000 });
  98  | 
  99  |     // Wait for the scan to finish and auto-navigation to the report page.
  100 |     await page.waitForURL(/\/repos\/[^/]+$/, { timeout: 60_000 });
  101 | 
  102 |     // -----------------------------------------------------------------------
  103 |     // Step 4: Assert the Drift Report screen renders ≥1 finding with a visible
  104 |     //   severity badge.
  105 |     //
  106 |     //   SeverityBadge renders one of: Critical / High / Medium / Low
  107 |     //   FindingsTable renders them inside a card with the badge as the first
  108 |     //   visible element per row.
  109 |     // -----------------------------------------------------------------------
  110 | 
  111 |     // Confirm we landed on a repo detail page
  112 |     expect(page.url()).toMatch(/\/repos\/[^/]+$/);
  113 | 
  114 |     // "Fired Findings" is a real <h2> inside FindingsTable — use h2 locator
  115 |     await expect(
  116 |       page.locator("h2").filter({ hasText: "Fired Findings" })
  117 |     ).toBeVisible({ timeout: 15_000 });
  118 | 
  119 |     // At least one severity badge must be visible.
  120 |     // SeverityBadge renders "Critical", "High", "Medium", or "Low" as
  121 |     // uppercase text in a <span> with tracked-wider styling.
  122 |     const severityBadge = page
  123 |       .locator("span")
  124 |       .filter({ hasText: /^(Critical|High|Medium|Low)$/ })
  125 |       .first();
  126 | 
  127 |     await expect(severityBadge).toBeVisible({ timeout: 15_000 });
  128 | 
  129 |     // Verify the summary card is rendered (CardTitle → <div>, use getByText)
  130 |     await expect(page.getByText("Critical & High Findings")).toBeVisible();
  131 | 
  132 |     // Verify at least one finding row shows a commit hash
  133 |     await expect(page.getByText(/Commit:/).first()).toBeVisible();
  134 |   });
  135 | });
  136 | 
```