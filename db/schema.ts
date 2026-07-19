import { pgTable, uuid, text, timestamp, doublePrecision, jsonb } from "drizzle-orm/pg-core";

export const repos = pgTable("repos", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
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
