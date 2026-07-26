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
}
