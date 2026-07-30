import { pgTable, uuid, text, timestamp, doublePrecision, jsonb, boolean } from "drizzle-orm/pg-core";

// Better Auth Schema tables
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  role: text("role").default("user").notNull(), // 'user' | 'admin'
  banned: boolean("banned").default(false),
  banReason: text("banReason"),
  banExpires: timestamp("banExpires"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});

// DriftGuard Core Tables
export const repos = pgTable("repos", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastScanAt: timestamp("last_scan_at"),
  latestDriftScore: doublePrecision("latest_drift_score").default(0),
});

export const scans = pgTable("scans", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .references(() => repos.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").notNull(), // e.g. 'pending', 'running', 'completed', 'failed'
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  error: text("error"),
  /**
   * Feature 6: trend-level alert persisted at scan completion.
   * Null when the score did not exceed the threshold in the rolling window.
   */
  trendAlert: jsonb("trend_alert").$type<Record<string, unknown> | null>().default(null),
});

export const findings = pgTable("findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  scanId: uuid("scan_id")
    .references(() => scans.id, { onDelete: "cascade" })
    .notNull(),
  file: text("file").notNull(),
  commit: text("commit").notNull(),
  author: text("author").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  severity: text("severity").notNull(), // 'critical', 'high', 'medium', 'low'
  score: doublePrecision("score").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  changeSummary: text("change_summary").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  explanation: text("explanation").notNull(),
  remediation: text("remediation").notNull(),
});

export const trendPoints = pgTable("trend_points", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .references(() => repos.id, { onDelete: "cascade" })
    .notNull(),
  date: timestamp("date").notNull(),
  score: doublePrecision("score").notNull(),
});

export const findingReviews = pgTable("finding_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  findingId: text("finding_id").notNull(),
  file: text("file").notNull(),
  commit: text("commit").notNull(),
  ruleId: text("rule_id"),
  severity: text("severity").notNull(),
  reason: text("reason").notNull(),
  status: text("status").default("pending").notNull(), // 'pending', 'resolved', 'dismissed'
  proof: jsonb("proof").$type<Record<string, unknown>>().notNull(), // Full snapshot of finding card proof
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

