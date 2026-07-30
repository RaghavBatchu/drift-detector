import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js Edge Middleware (proxy.ts convention for this Next.js version).
 *
 * This is the auth guard for all protected routes. It must be exported
 * as `middleware` for Next.js to execute it automatically.
 *
 * Protection strategy:
 *  - Page routes  → redirect to /sign-in with callbackUrl preserved
 *  - API routes   → return 401 JSON (client code handles gracefully)
 *  - Auth pages   → redirect already-authenticated users to /repos
 */
export function proxy(request: NextRequest) {
  // better-auth sets one of two cookie names depending on whether the
  // connection is HTTP (local dev) or HTTPS (production).
  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  const { pathname } = request.nextUrl;

  // ── Protected page routes ───────────────────────────────────────────────────
  const isProtectedPage =
    pathname.startsWith("/repos") ||
    pathname.startsWith("/api-docs");

  // ── Protected API routes ────────────────────────────────────────────────────
  const isProtectedApi =
    pathname.startsWith("/api/repos") ||
    pathname.startsWith("/api/scans") ||
    pathname.startsWith("/api/scan") ||    // POST /api/scan — start a scan
    pathname.startsWith("/api/report");    // GET  /api/report/[id] (singular)

  if ((isProtectedPage || isProtectedApi) && !sessionToken) {
    if (isProtectedApi) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 }
      );
    }
    // Page route — redirect to sign-in preserving the destination
    const loginUrl = new URL("/sign-in", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Auth pages ──────────────────────────────────────────────────────────────
  // Redirect already-authenticated users away from sign-in / sign-up / verify-email.
  if (sessionToken && (pathname === "/sign-in" || pathname === "/sign-up" || pathname === "/verify-email")) {
    return NextResponse.redirect(new URL("/repos", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protected pages
    "/repos/:path*",
    "/api-docs",
    "/api-docs/:path*",
    // Protected API routes
    "/api/repos/:path*",
    "/api/scans/:path*",
    "/api/scan",           // POST — start a new scan
    "/api/report/:path*",  // GET  — drift report (singular, not /reports)
    // Auth pages (redirect-if-authenticated logic)
    "/sign-in",
    "/sign-up",
    "/verify-email",
  ],
};

