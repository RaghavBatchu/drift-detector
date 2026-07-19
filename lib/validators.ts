import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);

export const ScanStatusSchema = z.enum([
  "queued",
  "cloning",
  "mining",
  "analyzing",
  "completed",
  "failed",
]);

export const FindingSchema = z.object({
  id: z.string().uuid().or(z.string()), // Allow both UUIDs (from DB) and string IDs
  file: z.string(),
  commit: z.string(),
  author: z.string(),
  timestamp: z.string(), // ISO timestamp representation
  severity: SeveritySchema,
  score: z.number(),
  confidence: z.number(),
  change_summary: z.string(),
  evidence: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()).optional(),
    rules: z.array(z.string()),
    pattern_match: z.number(),
  }),
  explanation: z.string(),
  remediation: z.string(),
});

export const DriftReportSchema = z.object({
  repo: z.string(),
  drift_score: z.number(),
  summary: z.object({
    changes_scanned: z.number(),
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
  }),
  findings: z.array(FindingSchema),
  trend: z.array(
    z.object({
      date: z.string(),
      score: z.number(),
    })
  ),
});

export const RepoSummarySchema = z.object({
  id: z.string().uuid().or(z.string()),
  url: z.string(),
  name: z.string(),
  last_scan_at: z.string().nullable(),
  latest_drift_score: z.number().nullable(),
});
