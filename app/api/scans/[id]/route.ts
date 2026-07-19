import { auth } from "@/lib/auth";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
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
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    // 3. Fetch repo to verify ownership
    const repo = await db.query.repos.findFirst({
      where: eq(schema.repos.id, scan.repoId),
    });

    if (!repo || repo.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 4. Return scan status and findings if completed
    const findings = scan.status === "completed"
      ? await db.query.findings.findMany({
          where: eq(schema.findings.scanId, scan.id),
        })
      : [];

    return NextResponse.json({
      id: scan.id,
      repoId: scan.repoId,
      status: scan.status,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      error: scan.error,
      findings,
    });
  } catch (err) {
    console.error("Failed to fetch scan:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
