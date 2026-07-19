import { auth } from "@/lib/auth";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { runMockScan } from "@/lib/mock-scan-engine";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // 1. Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // 2. Parse request body
  let url: string;
  try {
    const body = await req.json();
    url = body.url;
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 3. Validate URL
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json({ error: "URL must use HTTP or HTTPS protocol" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: "Malformed URL" }, { status: 400 });
  }

  // 4. Extract repository name from URL path
  const getRepoName = (urlStr: string) => {
    try {
      const u = new URL(urlStr);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
      return parts[0] || u.hostname;
    } catch (_) {
      return urlStr;
    }
  };

  const name = getRepoName(url);

  try {
    // 5. Upsert repos row
    const existingRepo = await db.query.repos.findFirst({
      where: and(eq(schema.repos.url, url), eq(schema.repos.userId, userId)),
    });

    let repoId: string;
    if (existingRepo) {
      repoId = existingRepo.id;
    } else {
      const [newRepo] = await db.insert(schema.repos)
        .values({
          userId,
          url,
          name,
          latestDriftScore: 0,
        })
        .returning();
      repoId = newRepo.id;
    }

    // 6. Create scans row
    const [newScan] = await db.insert(schema.scans)
      .values({
        repoId: repoId,
        status: "queued",
        startedAt: new Date(),
      })
      .returning();

    // 7. Kick off mock scan engine asynchronously (non-blocking)
    runMockScan(newScan.id).catch((err) => {
      console.error(`Uncaught error in runMockScan for ${newScan.id}:`, err);
    });

    // 8. Return scan_id immediately
    return NextResponse.json({ scan_id: newScan.id }, { status: 201 });
  } catch (err) {
    console.error("Failed to start scan:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
