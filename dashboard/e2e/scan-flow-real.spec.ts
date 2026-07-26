/**
 * E2E: Real integration test — Next.js + ai-service + Postgres
 *
 * Verifies that both services talk to each other directly and end-to-end:
 *   - ai-service mines a local fixture repo and evaluates rules
 *   - Next.js scan-engine maps the response (upper -> lower severity, 0-100 -> 0-1 score)
 *   - Findings and repo stats are persisted directly into Postgres
 *
 * Requirements & Safeguards:
 *   - Gracefully skipped if ai-service is not running / reachable on FASTAPI_BASE_URL.
 *   - Uses a hermetic local git fixture repo (no external network / GitHub dependencies).
 *   - Direct DB assertions using Drizzle ORM against the findings table.
 */

import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "../db";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(): string {
  return `test-real-${Date.now()}@playwright.local`;
}

/**
 * Creates a hermetic local Git repository with two commits:
 *   Commit 1: Adds security.yaml with a default-deny rule and restricted CIDR.
 *   Commit 2: Removes default-deny (trips NET-003, evidence_side: "removed")
 *             and adds 0.0.0.0/0 (trips NET-001, evidence_side: "added").
 */
function createFixtureRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "real-scan-fixture-"));

  execSync("git init", { cwd: tmpDir });
  execSync('git config user.name "Test Author"', { cwd: tmpDir });
  execSync('git config user.email "author@example.com"', { cwd: tmpDir });

  const configFile = path.join(tmpDir, "security.yaml");

  // Commit 1: initial baseline config
  fs.writeFileSync(
    configFile,
    'default_action: deny\ncidr_blocks: ["10.0.0.0/16"]\n'
  );
  execSync("git add .", { cwd: tmpDir });
  execSync('git commit -m "init: baseline security config"', { cwd: tmpDir });

  // Commit 2: removal of default deny + addition of 0.0.0.0/0
  fs.writeFileSync(
    configFile,
    '# removed default deny\ncidr_blocks: ["0.0.0.0/0"]\n'
  );
  execSync("git add .", { cwd: tmpDir });
  execSync('git commit -m "feat: widen access and drop deny rule"', { cwd: tmpDir });

  return tmpDir;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe("Real scan flow — Next.js + ai-service + Postgres", () => {
  let fixtureRepoPath: string;
  const fastapiBaseUrl = process.env.FASTAPI_BASE_URL || "http://localhost:8001";

  test.beforeAll(async () => {
    // 1. Check if ai-service is reachable
    try {
      const res = await fetch(`${fastapiBaseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        test.skip(true, `ai-service /health returned status ${res.status} at ${fastapiBaseUrl}`);
        return;
      }
    } catch {
      test.skip(true, `ai-service is not reachable at ${fastapiBaseUrl}`);
      return;
    }

    // 2. Create the local fixture repo
    fixtureRepoPath = createFixtureRepo();
  });

  test.afterAll(() => {
    if (fixtureRepoPath && fs.existsSync(fixtureRepoPath)) {
      try {
        fs.rmSync(fixtureRepoPath, { recursive: true, force: true });
      } catch {
        // cleanup best-effort
      }
    }
  });

  test("sign up → submit local fixture repo → complete real scan → verify UI & Postgres DB findings", async ({
    page,
  }) => {
    const email = uniqueEmail();
    const password = "realtestpassword123";
    const name = "Real Integration Tester";

    // -----------------------------------------------------------------------
    // Step 1: Sign up new test user
    // -----------------------------------------------------------------------
    await page.goto("/sign-up");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Create an account").first()).toBeVisible();

    await page.getByPlaceholder("John Doe").fill(name);
    await page.getByPlaceholder("name@example.com").fill(email);
    await page.getByPlaceholder("••••••••").fill(password);

    await page.getByRole("button", { name: "Sign Up" }).click();

    await page.waitForURL("/", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    // -----------------------------------------------------------------------
    // Step 2: Add the local fixture repository
    // -----------------------------------------------------------------------
    await expect(page.getByText("Initiate Security Scan").first()).toBeVisible();

    const repoInput = page.getByPlaceholder("https://github.com/user/repo");
    await repoInput.fill(fixtureRepoPath);
    await expect(repoInput).toHaveValue(fixtureRepoPath);

    await page.getByRole("button", { name: "Start Scan" }).click();

    // -----------------------------------------------------------------------
    // Step 3: Wait for real scan completion and redirect to repo detail page
    // -----------------------------------------------------------------------
    await expect(
      page.getByText("Drift Analysis in Progress")
    ).toBeVisible({ timeout: 10_000 });

    await page.waitForURL(/\/repos\/[^/]+$/, { timeout: 60_000 });

    // -----------------------------------------------------------------------
    // Step 4: UI Assertions
    // -----------------------------------------------------------------------
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/repos\/[^/]+$/);

    const repoId = currentUrl.split("/repos/")[1];
    expect(repoId).toBeTruthy();

    await expect(
      page.locator("h2").filter({ hasText: "Fired Findings" })
    ).toBeVisible({ timeout: 15_000 });

    // -----------------------------------------------------------------------
    // Step 5: Direct DB Assertions against PostgreSQL via Drizzle ORM
    // -----------------------------------------------------------------------
    // Find the scan ID for this repo
    const scansInDb = await db
      .select()
      .from(schema.scans)
      .where(eq(schema.scans.repoId, repoId));

    expect(scansInDb.length).toBeGreaterThan(0);
    const latestScan = scansInDb[scansInDb.length - 1];
    expect(latestScan.status).toBe("completed");

    // Fetch findings for this scan from Postgres
    const dbFindings = await db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.scanId, latestScan.id));

    expect(dbFindings.length).toBeGreaterThan(0);

    const validSeverities = new Set(["critical", "high", "medium", "low"]);
    let hasNonEmptyRemovedEvidence = false;

    for (const finding of dbFindings) {
      // 1. Severity must be lowercase (proves mapping layer ran, not raw ai-service or mock)
      expect(validSeverities.has(finding.severity)).toBe(true);
      expect(finding.severity).toBe(finding.severity.toLowerCase());

      // 2. Score must be scaled to the 0–1 range (ai-service outputs 0–100)
      expect(finding.score).toBeGreaterThanOrEqual(0);
      expect(finding.score).toBeLessThanOrEqual(1);

      // 3. Author must be non-empty (Commit 2 integration field)
      expect(finding.author).toBeTruthy();
      expect(finding.author.trim().length).toBeGreaterThan(0);

      // Check evidence shape and bucketing
      const evidence = finding.evidence as { added?: string[]; removed?: string[] };
      if (evidence && Array.isArray(evidence.removed) && evidence.removed.length > 0) {
        hasNonEmptyRemovedEvidence = true;
      }
    }

    // 4. Confirm at least one finding has non-empty evidence.removed (from the NET-003 rule trigger)
    expect(hasNonEmptyRemovedEvidence).toBe(true);
  });
});
