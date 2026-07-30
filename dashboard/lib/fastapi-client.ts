/**
 * Thin HTTP client for the ai-service.
 *
 * Deliberately typed against the *ai-service* wire format — not the
 * dashboard's own DriftReport/Finding types from types/contracts.ts.
 * Keeping these two shapes distinct is what makes the mapping layer
 * (Commit 6) possible to write and test cleanly.
 *
 * The only business logic here is the error surface:
 *   - non-2xx → throws Error with status + body text
 *   - network failure → propagates the fetch rejection as-is
 *
 * Environment: FASTAPI_BASE_URL must be set (server-side only — this
 * file is never imported on the client). See .env.example.
 */

// ---------------------------------------------------------------------------
// Raw wire types — mirrors ai-service/app/models.py exactly.
// Upper-case severity, snake_case field names, flat evidence: string[].
// ---------------------------------------------------------------------------

/** Severity as the ai-service emits it — upper-case. */
export type RawSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/**
 * One finding from the ai-service /scan (or /analyze) response.
 * Maps 1-to-1 with the Python Finding Pydantic model.
 */
export interface RawFinding {
  file_path: string;
  commit_hash: string;
  commit_date: string;
  /** Upper-case: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" */
  severity: RawSeverity;
  /** 0–100 final weighted score (NOT 0–1). */
  risk_score: number;
  /** 0–1 confidence scalar. */
  confidence: number;
  rule_id: string | null;
  rule_name: string | null;
  category: string;
  /** Flat string[] of exact lines that triggered the finding. */
  evidence: string[];
  /** "rule" | "semantic" | "rule+semantic" | "llm" */
  matched_by: "rule" | "semantic" | "rule+semantic" | "llm" | string;
  nearest_pattern: string | null;
  similarity: number | null;
  explanation: string;
  remediation: string;
  // Commit 2 integration-only fields
  author: string;
  change_summary: string;
  /** "added" | "removed" */
  evidence_side: string;
}

/** Chronological trend point from the ai-service. */
export interface RawTrendPoint {
  date: string;
  cumulative_drift: number;
}

/**
 * Trend-level alert from the ai-service (Feature 6).
 * Maps 1-to-1 with the Python dict returned by scoring.trend_alert().
 * Present only when the accumulated score rose above the threshold.
 */
export interface RawTrendAlert {
  fired: true;
  score_start: number;
  score_end: number;
  delta: number;
  window_days: number;
  threshold: number;
  points_in_window: number;
  confidence: number;
  message: string;
}

/**
 * Full response from POST /scan (and POST /analyze).
 * Maps 1-to-1 with the Python AnalyzeResponse Pydantic model.
 */
export interface RawAnalyzeResponse {
  repo_id: string;
  /** 0–100 per-scan drift accumulation (this scan's findings only). */
  drift_score: number;
  /**
   * 0–100 decay-weighted accumulated score across ALL prior scans.
   * Computed by ai-service from prior_scores + this scan's drift_score.
   */
  repo_score: number;
  /** Chronological list — values are monotonically non-decreasing. */
  risk_trend: RawTrendPoint[];
  /** Counts by upper-case severity key, e.g. { CRITICAL: 2, HIGH: 1 } */
  summary: Record<RawSeverity, number>;
  findings: RawFinding[];
  analyzed_changes: number;
  /** Embedder, index backend, rule/pattern counts, and llm_fallback status. */
  engine_info: Record<string, string | number | boolean | Record<string, unknown>>;
  /**
   * Feature 6: trend-level alert. Non-null when the accumulated score rose
   * more than the threshold within the rolling window. Null otherwise.
   */
  trend_alert: RawTrendAlert | null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * POST /scan — hand the ai-service a repo URL, get a full analysis back.
 *
 * @param repoUrl           Public (or locally accessible) git repo URL.
 * @param scanId            Caller-supplied ID round-tripped as `repo_id` in the
 *                          response. Used for logging/correlation; not interpreted
 *                          by the ai-service.
 * @param priorScores       Previous per-scan drift scores for this repo (0-100),
 *                          oldest first. Forwarded to ai-service so it can compute
 *                          the decay-weighted accumulated repo_score. Pass [] for
 *                          a first scan.
 * @param priorTrendPoints  Previous dated trend points [{date, score (0-100)}],
 *                          oldest first. Forwarded for trend_alert() (Feature 6).
 *                          Pass [] for a first scan.
 * @returns                 Raw ai-service response — call the mapping layer
 *                          (map-analyze-response.ts) to convert to a DriftReport.
 * @throws                  Error if the HTTP response is not 2xx, with message
 *                          `"ai-service scan failed: <status> <body>"`.
 */
export async function scanRepo(
  repoUrl: string,
  scanId: string,
  priorScores: number[] = [],
  priorTrendPoints: { date: string; score: number }[] = []
): Promise<RawAnalyzeResponse> {
  const baseUrl = process.env.FASTAPI_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "FASTAPI_BASE_URL is not set. Add it to your .env.local (see .env.example)."
    );
  }

  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) {
    throw new Error(
      "INTERNAL_API_KEY is not set. Add it to your .env.local (see .env.example)."
    );
  }

  const res = await fetch(`${baseUrl}/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": internalApiKey,
    },
    body: JSON.stringify({
      repo_url: repoUrl,
      scan_id: scanId,
      prior_scores: priorScores,
      prior_trend_points: priorTrendPoints,
    }),
    // next: { revalidate: 0 } — always fresh; scans are never idempotent
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ai-service scan failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<RawAnalyzeResponse>;
}
