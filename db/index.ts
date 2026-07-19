import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder";

const isLocal = !databaseUrl.includes("neon.tech");

export const db = isLocal
  ? drizzlePg(new Pool({ connectionString: databaseUrl }), { schema })
  : drizzleNeon(neon(databaseUrl), { schema });

