/**
 * Next.js Instrumentation hook (runs once at server startup).
 * Automatically seeds and enforces the System Admin user account.
 *
 * Admin Credentials:
 *   Email:    admin@driftguard.com
 *   Password: AdminPassword123!
 *   Role:     admin
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { auth } = await import("@/lib/auth");
      const { db } = await import("@/db");
      const { user } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");

      const adminEmail = "admin@driftguard.com";
      const adminPassword = "AdminPassword123!";
      const adminName = "System Admin";

      const existing = await db.query.user.findFirst({
        where: eq(user.email, adminEmail),
      });

      if (!existing) {
        console.log(`[Instrumentation] Seeding initial admin account: ${adminEmail}…`);
        try {
          await auth.api.signUpEmail({
            body: {
              email: adminEmail,
              password: adminPassword,
              name: adminName,
            },
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log("[Instrumentation] signUpEmail status:", msg);
        }
      }

      // Ensure admin role is set to 'admin' and email is verified
      await db
        .update(user)
        .set({ role: "admin", emailVerified: true })
        .where(eq(user.email, adminEmail));

      console.log(`[Instrumentation] ✓ Admin account ready: ${adminEmail} (Role: admin)`);
    } catch (err) {
      console.error("[Instrumentation] Failed to seed admin user:", err);
    }
  }
}
