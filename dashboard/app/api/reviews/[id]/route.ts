import { auth } from "@/lib/auth";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * @swagger
 * /api/reviews/{id}:
 *   patch:
 *     summary: Update review status
 *     description: Update status of a review (pending, resolved, dismissed).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RBAC: Only admin role can update review status
  const userRole = (session.user as { role?: string }).role || "user";
  if (userRole !== "admin") {
    return NextResponse.json({ error: "Forbidden. Admin access required." }, { status: 403 });
  }

  const { id: reviewId } = await params;

  try {
    const body = await req.json();
    const { status } = body;

    if (!status || !["pending", "resolved", "dismissed"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status parameter. Must be pending, resolved, or dismissed." },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(schema.findingReviews)
      .set({ status })
      .where(eq(schema.findingReviews.id, reviewId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Failed to update review status:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
