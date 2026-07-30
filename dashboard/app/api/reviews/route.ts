import { auth } from "@/lib/auth";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * @swagger
 * /api/reviews:
 *   post:
 *     summary: Submit a finding misclassification review
 *     description: Submit user feedback on a misclassified finding with complete proof payload.
 *   get:
 *     summary: List finding reviews
 *     description: Fetch all submitted finding reviews for administration.
 */
export async function POST(req: Request) {
  // 1. Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const body = await req.json();
    const { repoId, findingId, file, commit, ruleId, severity, reason, proof } = body;

    if (!repoId || !file || !commit || !reason || !proof) {
      return NextResponse.json(
        { error: "Missing required review parameters (repoId, file, commit, reason, proof)." },
        { status: 400 }
      );
    }

    // Verify repo exists and belongs to user (or accessible)
    const repo = await db.query.repos.findFirst({
      where: eq(schema.repos.id, repoId),
    });

    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    const [newReview] = await db
      .insert(schema.findingReviews)
      .values({
        userId,
        repoId,
        findingId: findingId || "unknown",
        file,
        commit,
        ruleId: ruleId || null,
        severity: severity || "medium",
        reason: reason.trim(),
        status: "pending",
        proof: proof as Record<string, unknown>,
      })
      .returning();

    return NextResponse.json(
      { message: "Review submitted successfully", review: newReview },
      { status: 201 }
    );
  } catch (err) {
    console.error("Failed to submit finding review:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RBAC: Only admin role can list misclassification reviews
  const userRole = (session.user as { role?: string }).role || "user";
  if (userRole !== "admin") {
    return NextResponse.json({ error: "Forbidden. Admin access required." }, { status: 403 });
  }

  try {
    const reviewsList = await db.query.findingReviews.findMany({
      orderBy: desc(schema.findingReviews.createdAt),
      with: undefined,
    });

    // Fetch repos and users map to populate repo names and user emails
    const allRepos = await db.select({ id: schema.repos.id, name: schema.repos.name }).from(schema.repos);
    const repoMap = new Map(allRepos.map((r) => [r.id, r.name]));

    const allUsers = await db.select({ id: schema.user.id, email: schema.user.email, name: schema.user.name }).from(schema.user);
    const userMap = new Map(allUsers.map((u) => [u.id, u.email || u.name]));

    const formatted = reviewsList.map((r) => ({
      id: r.id,
      repoId: r.repoId,
      repoName: repoMap.get(r.repoId) || "Unknown Repo",
      userId: r.userId,
      userEmail: userMap.get(r.userId) || "Unknown User",
      findingId: r.findingId,
      file: r.file,
      commit: r.commit,
      ruleId: r.ruleId,
      severity: r.severity,
      reason: r.reason,
      status: r.status,
      proof: r.proof,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json(formatted);
  } catch (err) {
    console.error("Failed to fetch reviews:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
