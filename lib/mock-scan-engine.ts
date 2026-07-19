import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, ne } from "drizzle-orm";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runMockScan(scanId: string): Promise<void> {
  console.log(`Starting mock scan execution for scan ID: ${scanId}`);

  try {
    // 1. Fetch scan and repo
    const scan = await db.query.scans.findFirst({
      where: eq(schema.scans.id, scanId),
    });
    if (!scan) {
      console.error(`Scan with ID ${scanId} not found in mock scan engine.`);
      return;
    }

    const repo = await db.query.repos.findFirst({
      where: eq(schema.repos.id, scan.repoId),
    });
    if (!repo) {
      console.error(`Repo associated with scan ${scanId} not found.`);
      return;
    }

    // Step 1: Queued (already set on insert, wait 4s)
    await delay(4000);

    // Step 2: Cloning
    await db.update(schema.scans)
      .set({ status: "cloning" })
      .where(eq(schema.scans.id, scanId));
    console.log(`Scan ${scanId} transitioned to cloning`);
    await delay(4000);

    // Step 3: Mining
    await db.update(schema.scans)
      .set({ status: "mining" })
      .where(eq(schema.scans.id, scanId));
    console.log(`Scan ${scanId} transitioned to mining`);
    await delay(4000);

    // Step 4: Analyzing
    await db.update(schema.scans)
      .set({ status: "analyzing" })
      .where(eq(schema.scans.id, scanId));
    console.log(`Scan ${scanId} transitioned to analyzing`);
    await delay(4000);

    // Step 5: Complete or Fail Check
    const isPrivateRepo =
      repo.url === "https://github.com/acme/private-infra" ||
      repo.url.includes("private-repo") ||
      repo.url.includes("secret-repo");

    if (isPrivateRepo) {
      await db.update(schema.scans)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error: "Repository is private. Please configure SSH credentials or upgrade to Enterprise to scan private repositories.",
        })
        .where(eq(schema.scans.id, scanId));
      console.log(`Scan ${scanId} failed (private repository access denied)`);
      return;
    }

    // Success Path - completed status
    await db.update(schema.scans)
      .set({
        status: "completed",
        finishedAt: new Date(),
      })
      .where(eq(schema.scans.id, scanId));
    console.log(`Scan ${scanId} marked as completed`);

    // Fetch findings pool (seed data findings)
    const seededFindings = await db.select().from(schema.findings).where(ne(schema.findings.scanId, scanId));

    let driftScore = 0.0;
    const isDemoRepo = repo.url === "https://github.com/acme/payments-infra";

    if (seededFindings.length > 0) {
      let findingsToInsert = [];

      if (isDemoRepo) {
        // Clone all 10 seeded findings
        findingsToInsert = seededFindings.map((f) => ({
          scanId: scanId,
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
        }));
        driftScore = 0.93;
      } else {
        // Shuffle and take a subset of 3 to 6 findings
        const shuffled = [...seededFindings].sort(() => 0.5 - Math.random());
        const count = Math.floor(Math.random() * 4) + 3; // 3 to 6
        const selected = shuffled.slice(0, count);

        findingsToInsert = selected.map((f) => {
          const randomCommit = Math.random().toString(16).substring(2, 8);
          return {
            scanId: scanId,
            file: f.file,
            commit: randomCommit,
            author: f.author,
            timestamp: new Date(),
            severity: f.severity,
            score: f.score,
            confidence: f.confidence,
            changeSummary: f.changeSummary,
            evidence: f.evidence,
            explanation: f.explanation,
            remediation: f.remediation,
          };
        });

        const totalScore = selected.reduce((sum, f) => sum + f.score, 0);
        driftScore = parseFloat((totalScore / selected.length).toFixed(2));
      }

      if (findingsToInsert.length > 0) {
        await db.insert(schema.findings).values(findingsToInsert);
        console.log(`Inserted ${findingsToInsert.length} findings for scan ${scanId}`);
      }
    } else {
      console.warn("No findings pool available for duplication. Inserting empty findings.");
    }

    // Update Repo drift score and scan timestamp
    await db.update(schema.repos)
      .set({
        latestDriftScore: driftScore,
        lastScanAt: new Date(),
      })
      .where(eq(schema.repos.id, repo.id));

    // Insert new trend point
    await db.insert(schema.trendPoints).values({
      repoId: repo.id,
      date: new Date(),
      score: driftScore,
    });
    console.log(`Updated repo stats and trend points for repo ${repo.id}`);

  } catch (error) {
    console.error(`Error in mock scan engine for scan ${scanId}:`, error);
    try {
      await db.update(schema.scans)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error: "An internal error occurred during analysis.",
        })
        .where(eq(schema.scans.id, scanId));
    } catch (dbErr) {
      console.error("Failed to write failure status to DB:", dbErr);
    }
  }
}
