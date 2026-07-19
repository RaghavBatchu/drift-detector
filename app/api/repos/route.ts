import { auth } from "@/lib/auth";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  // 1. Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // 2. Fetch repos
    const repos = await db.select()
      .from(schema.repos)
      .where(eq(schema.repos.userId, userId));

    // 3. Map to RepoSummary[] contract
    const summaries = repos.map((r) => ({
      id: r.id,
      url: r.url,
      name: r.name,
      last_scan_at: r.lastScanAt ? r.lastScanAt.toISOString() : null,
      latest_drift_score: r.latestDriftScore,
    }));

    return NextResponse.json(summaries);
  } catch (err) {
    console.error("Failed to list repositories:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
