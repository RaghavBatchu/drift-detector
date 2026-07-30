/**
 * migrate.mjs — run Drizzle ORM migrations at container startup.
 *
 * Uses the @neondatabase/serverless HTTP driver so it works from inside
 * Alpine Docker containers where the TCP pg driver hangs on Neon's
 * channel_binding=require SSL negotiation.
 *
 * Run: node migrate.mjs
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("ERROR: DATABASE_URL is not set — cannot run migrations.");
  process.exit(1);
}

const isNeon = databaseUrl.includes("neon.tech");

if (isNeon) {
  // Neon Serverless: use HTTP driver — no TCP/SSL issues inside Alpine.
  console.log("Running migrations via Neon HTTP driver…");
  const sql = neon(databaseUrl);
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: join(__dirname, "drizzle") });
  } catch (e) {
    console.log("Migrate note:", e?.message || e);
  }
  await sql.transaction([
    sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL`,
    sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false`,
    sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" text`,
    sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" timestamp`,
  ]);
} else {
  // Local Postgres (docker-compose dev or CI): use node-postgres.
  const { default: pg } = await import("pg");
  const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
  const { migrate: migratePg } = await import("drizzle-orm/node-postgres/migrator");
  console.log("Running migrations via node-postgres driver…");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzlePg(pool);
  try {
    await migratePg(db, { migrationsFolder: join(__dirname, "drizzle") });
  } catch (e) {
    console.log("Migrate note:", e?.message || e);
  }
  await pool.query(`
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" text;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" timestamp;
  `);
  await pool.end();
}

console.log("✓ Migrations applied successfully.");
