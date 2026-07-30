/**
 * seed-admin.mjs — seed/ensure admin account exists on startup.
 *
 * Seed Credentials:
 *   Email:    admin@driftguard.com
 *   Password: AdminPassword123!
 *   Role:     admin
 */
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("ERROR: DATABASE_URL is not set — cannot seed admin.");
  process.exit(1);
}

const adminEmail = "admin@driftguard.com";
const adminPassword = "AdminPassword123!";
const adminName = "System Admin";

async function seedAdmin() {
  const isNeon = databaseUrl.includes("neon.tech");
  let queryFn;

  if (isNeon) {
    const sql = neon(databaseUrl);
    queryFn = async (text, params) => {
      const res = await sql.query(text, params);
      return res.rows || res;
    };
  } else {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    queryFn = async (text, params) => {
      const res = await pool.query(text, params);
      return res.rows;
    };
  }

  console.log(`Checking admin user status for ${adminEmail}…`);

  try {
    const existing = await queryFn(
      `SELECT id, role, "emailVerified" FROM "user" WHERE email = $1`,
      [adminEmail]
    );

    if (existing && existing.length > 0) {
      console.log(`Admin user ${adminEmail} already exists. Ensuring role='admin' and emailVerified=true…`);
      await queryFn(
        `UPDATE "user" SET role = 'admin', "emailVerified" = true WHERE email = $1`,
        [adminEmail]
      );
    } else {
      console.log(`Creating initial admin account: ${adminEmail}…`);
      const { auth } = await import("./lib/auth.ts");
      try {
        await auth.api.signUpEmail({
          body: {
            email: adminEmail,
            password: adminPassword,
            name: adminName,
          },
        });
      } catch (e) {
        console.log("signUpEmail note:", e?.message || e);
      }

      // Set admin role and verify email directly in DB
      await queryFn(
        `UPDATE "user" SET role = 'admin', "emailVerified" = true WHERE email = $1`,
        [adminEmail]
      );
    }

    console.log(`✓ Admin account ready: ${adminEmail} (Role: admin)`);
  } catch (err) {
    console.error("Failed to seed admin user:", err);
  }
}

seedAdmin();
