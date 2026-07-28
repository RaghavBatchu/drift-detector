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
  await migrate(db, { migrationsFolder: join(__dirname, "drizzle") });
} else {
  // Local Postgres (docker-compose dev or CI): use node-postgres.
  const { default: pg } = await import("pg");
  const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
  const { migrate: migratePg } = await import("drizzle-orm/node-postgres/migrator");
  console.log("Running migrations via node-postgres driver…");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzlePg(pool);
  await migratePg(db, { migrationsFolder: join(__dirname, "drizzle") });
  await pool.end();
}

console.log("✓ Migrations applied successfully.");
