/**
 * Scan engine — orchestrates a full repo scan end-to-end.
 *
 * Happy path (FASTAPI_BASE_URL is set):
 *   queued → cloning → [ai-service call] → analyzing → [map + persist] → completed
 *
 * Fallback (FASTAPI_BASE_URL is unset):
 *   Runs the original mock-timer behaviour so `pnpm dev` works with
 *   nothing else running. Logs a prominent warning so it's impossible
 *   to miss that the app is in standalone/demo mode.
 *
 * Error path:
 *   Any thrown error (network failure, ai-service 400, DB write, etc.)
 *   transitions status → "failed" with a clean human-readable message.
 */

import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, ne } from "drizzle-orm";

import { scanRepo } from "@/lib/fastapi-client";
import { mapAnalyzeResponse } from "@/lib/map-analyze-response";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setStatus(
  scanId: string,
  status: string,
  extra: Record<string, unknown> = {}
) {
  await db
    .update(schema.scans)
    .set({ status, ...extra })
    .where(eq(schema.scans.id, scanId));
}

async function failScan(scanId: string, message: string) {
  try {
    await setStatus(scanId, "failed", {
      finishedAt: new Date(),
      error: message,
    });
  } catch (dbErr) {
    console.error(`[scan-engine] Failed to write "failed" status for ${scanId}:`, dbErr);
  }
}

// ---------------------------------------------------------------------------
// Real engine (FASTAPI_BASE_URL is set)
// ---------------------------------------------------------------------------

async function runRealScan(scanId: string): Promise<void> {
  // 1. Load scan + repo
  const scan = await db.query.scans.findFirst({
    where: eq(schema.scans.id, scanId),
  });
  if (!scan) {
    console.error(`[scan-engine] Scan ${scanId} not found.`);
    return;
  }

  const repo = await db.query.repos.findFirst({
    where: eq(schema.repos.id, scan.repoId),
  });
  if (!repo) {
    console.error(`[scan-engine] Repo for scan ${scanId} not found.`);
    return;
  }

  // 2. Cloning → call ai-service
  await setStatus(scanId, "cloning");
  console.log(`[scan-engine] ${scanId}: cloning ${repo.url}`);

  let raw;
  try {
    raw = await scanRepo(repo.url, scanId);
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : "ai-service scan failed with an unknown error.";
    console.error(`[scan-engine] ${scanId}: ai-service error — ${msg}`);
    await failScan(scanId, msg);
    return;
  }

  // 3. Analyzing → map the response
  await setStatus(scanId, "analyzing");
  console.log(`[scan-engine] ${scanId}: mapping ${raw.findings.length} findings`);

  const { findings, summary, drift_score } = mapAnalyzeResponse(raw);

  // 4. Persist findings
  if (findings.length > 0) {
    await db.insert(schema.findings).values(
      findings.map((f) => ({
        scanId,
        file: f.file,
        commit: f.commit,
        author: f.author,
        timestamp: f.timestamp ? new Date(f.timestamp) : new Date(),
        severity: f.severity,
        score: f.score,
        confidence: f.confidence,
        changeSummary: f.change_summary,
        evidence: f.evidence as Record<string, unknown>,
        explanation: f.explanation,
        remediation: f.remediation,
      }))
    );
    console.log(`[scan-engine] ${scanId}: persisted ${findings.length} findings`);
  }

  // 5. Update repo stats
  await db
    .update(schema.repos)
    .set({ latestDriftScore: drift_score, lastScanAt: new Date() })
    .where(eq(schema.repos.id, repo.id));

  // 6. Insert one trend_points row (date = now, score = mapped drift_score)
  await db.insert(schema.trendPoints).values({
    repoId: repo.id,
    date: new Date(),
    score: drift_score,
  });

  // 7. Mark completed
  await setStatus(scanId, "completed", { finishedAt: new Date() });
  console.log(
    `[scan-engine] ${scanId}: completed — drift_score=${drift_score.toFixed(3)}, ` +
    `findings=${findings.length}, changes_scanned=${summary.changes_scanned}`
  );
}

// ---------------------------------------------------------------------------
// Mock fallback (FASTAPI_BASE_URL is unset)
// Preserved verbatim from mock-scan-engine.ts so standalone dev still works.
// ---------------------------------------------------------------------------

async function runMockFallback(scanId: string): Promise<void> {
  console.warn(
    "\n⚠️  [scan-engine] FASTAPI_BASE_URL is not set — running in standalone/demo mode.\n" +
    "    Set FASTAPI_BASE_URL in .env.local (see .env.example) to use the real ai-service.\n"
  );

  const scan = await db.query.scans.findFirst({
    where: eq(schema.scans.id, scanId),
  });
  if (!scan) {
    console.error(`[scan-engine] Scan ${scanId} not found.`);
    return;
  }

  const repo = await db.query.repos.findFirst({
    where: eq(schema.repos.id, scan.repoId),
  });
  if (!repo) {
    console.error(`[scan-engine] Repo for scan ${scanId} not found.`);
    return;
  }

  // Simulate pipeline stages with delays
  await delay(4000);
  await setStatus(scanId, "cloning");
  await delay(4000);
  await setStatus(scanId, "mining");
  await delay(4000);
  await setStatus(scanId, "analyzing");
  await delay(4000);

  const isPrivateRepo =
    repo.url === "https://github.com/acme/private-infra" ||
    repo.url.includes("private-repo") ||
    repo.url.includes("secret-repo");

  if (isPrivateRepo) {
    await setStatus(scanId, "failed", {
      finishedAt: new Date(),
      error:
        "Repository is private. Please configure SSH credentials or upgrade to Enterprise to scan private repositories.",
    });
    return;
  }

  await setStatus(scanId, "completed", { finishedAt: new Date() });

  // Re-use seeded findings from other scans as mock data
  const seededFindings = await db
    .select()
    .from(schema.findings)
    .where(ne(schema.findings.scanId, scanId));

  let driftScore = 0.0;
  const isDemoRepo = repo.url === "https://github.com/acme/payments-infra";

  if (seededFindings.length > 0) {
    let findingsToInsert: (typeof seededFindings[0] & { scanId: string })[] = [];

    if (isDemoRepo) {
      findingsToInsert = seededFindings.map((f) => ({ ...f, scanId }));
      driftScore = 0.93;
    } else {
      const shuffled = [...seededFindings].sort(() => 0.5 - Math.random());
      const count = Math.floor(Math.random() * 4) + 3;
      const selected = shuffled.slice(0, count);

      findingsToInsert = selected.map((f) => ({
        ...f,
        scanId,
        commit: Math.random().toString(16).substring(2, 8),
        timestamp: new Date(),
      }));

      const totalScore = selected.reduce((sum, f) => sum + f.score, 0);
      driftScore = parseFloat((totalScore / selected.length).toFixed(2));
    }

    if (findingsToInsert.length > 0) {
      await db.insert(schema.findings).values(
        findingsToInsert.map((f) => ({
          scanId: f.scanId,
          file: f.file,
          commit: f.commit,
          author: f.author,
          timestamp: f.timestamp,
          severity: f.severity,
          score: f.score,
          confidence: f.confidence,
          changeSummary: f.changeSummary,
          evidence: f.evidence,
          explanation: f.explanation,
          remediation: f.remediation,
        }))
      );
    }
  }

  await db
    .update(schema.repos)
    .set({ latestDriftScore: driftScore, lastScanAt: new Date() })
    .where(eq(schema.repos.id, repo.id));

  await db.insert(schema.trendPoints).values({
    repoId: repo.id,
    date: new Date(),
    score: driftScore,
  });
}

// ---------------------------------------------------------------------------
// Public API — same signature as the old runMockScan
// ---------------------------------------------------------------------------

/**
 * Run a full repo scan for the given scan ID.
 *
 * Routes to the real ai-service pipeline when FASTAPI_BASE_URL is set,
 * or falls back to mock-timer behaviour for standalone/demo mode.
 * All errors are caught and written to the DB as "failed" status.
 */
export async function runScan(scanId: string): Promise<void> {
  const useRealEngine = !!process.env.FASTAPI_BASE_URL;

  try {
    if (useRealEngine) {
      await runRealScan(scanId);
    } else {
      await runMockFallback(scanId);
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    console.error(`[scan-engine] Unhandled error for scan ${scanId}:`, err);
    await failScan(scanId, msg);
  }
}
