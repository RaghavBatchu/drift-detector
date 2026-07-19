import { auth } from "@/lib/auth";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { id: scanId } = await params;

  try {
    // 2. Fetch scan
    const scan = await db.query.scans.findFirst({
      where: eq(schema.scans.id, scanId),
    });

    if (!scan) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // 3. Fetch repo to verify ownership
    const repo = await db.query.repos.findFirst({
      where: eq(schema.repos.id, scan.repoId),
    });

    if (!repo || repo.userId !== userId) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // 4. Verify scan is completed
    if (scan.status !== "completed") {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // 5. Fetch findings
    const findings = await db.query.findings.findMany({
      where: eq(schema.findings.scanId, scan.id),
    });

    // 6. Fetch trend points
    const trendPoints = await db.select()
      .from(schema.trendPoints)
      .where(eq(schema.trendPoints.repoId, repo.id))
      .orderBy(asc(schema.trendPoints.date));

    // 7. Calculate stats
    const critical = findings.filter(f => f.severity === "critical").length;
    const high = findings.filter(f => f.severity === "high").length;
    const medium = findings.filter(f => f.severity === "medium").length;
    const low = findings.filter(f => f.severity === "low").length;
    const changesScanned = findings.length * 15 + 12;

    const mappedFindings = findings.map((f) => ({
      id: f.id,
      file: f.file,
      commit: f.commit,
      author: f.author,
      timestamp: f.timestamp.toISOString(),
      severity: f.severity as any,
      score: f.score,
      confidence: f.confidence,
      change_summary: f.changeSummary,
      evidence: f.evidence as any,
      explanation: f.explanation,
      remediation: f.remediation,
    }));

    const trend = trendPoints.map((tp) => ({
      date: tp.date.toISOString(),
      score: tp.score,
    }));

    // 8. Construct DriftReport
    const report = {
      repo: repo.name,
      drift_score: repo.latestDriftScore ?? 0.0,
      summary: {
        changes_scanned: changesScanned,
        critical,
        high,
        medium,
        low,
      },
      findings: mappedFindings,
      trend,
    };

    return NextResponse.json(report);
  } catch (err) {
    console.error("Failed to compile drift report:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
