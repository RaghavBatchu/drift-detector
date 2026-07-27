export type Severity = "critical" | "high" | "medium" | "low";

export type ScanStatus = "queued" | "cloning" | "mining" | "analyzing" | "completed" | "failed";

export interface Finding {
  id: string;
  file: string;
  commit: string;
  author: string;
  timestamp: string;
  severity: Severity;
  score: number;
  confidence: number;
  change_summary: string;
  evidence: {
    added: string[];
    removed?: string[];
    rules: string[]; // empty array = "caught by similarity, not rules"
    pattern_match: number;
  };
  explanation: string;
  remediation: string;
}

export interface ReportSummary {
  changes_scanned: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface DriftReport {
  repo: string;
  drift_score: number;
  /**
   * Decay-weighted accumulated drift score across all scans for this repo.
   * Range 0–1. Reflects compounding risk history, not just the latest scan.
   */
  repo_accumulated_score: number;
  summary: ReportSummary;
  findings: Finding[];
  trend: { date: string; score: number }[];
}

export interface RepoSummary {
  id: string;
  url: string;
  name: string;
  last_scan_at: string | null;
  latest_drift_score: number | null;
  /**
   * Decay-weighted accumulated drift score stored in repos.latestDriftScore.
   * Same value as the most recent trend_points row for this repo.
   */
  repo_accumulated_score: number | null;
}
