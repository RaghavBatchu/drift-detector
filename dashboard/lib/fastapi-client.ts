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
  /** "rule" | "semantic" | "rule+semantic" */
  matched_by: string;
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
 * Full response from POST /scan (and POST /analyze).
 * Maps 1-to-1 with the Python AnalyzeResponse Pydantic model.
 */
export interface RawAnalyzeResponse {
  repo_id: string;
  /** 0–100 repo-level drift accumulation. */
  drift_score: number;
  /** Chronological list — values are monotonically non-decreasing. */
  risk_trend: RawTrendPoint[];
  /** Counts by upper-case severity key, e.g. { CRITICAL: 2, HIGH: 1 } */
  summary: Record<RawSeverity, number>;
  findings: RawFinding[];
  analyzed_changes: number;
  engine_info: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * POST /scan — hand the ai-service a repo URL, get a full analysis back.
 *
 * @param repoUrl  Public (or locally accessible) git repo URL.
 * @param scanId   Caller-supplied ID round-tripped as `repo_id` in the
 *                 response. Used for logging/correlation; not interpreted
 *                 by the ai-service.
 * @returns        Raw ai-service response — call the mapping layer
 *                 (Commit 6) to convert this to a DriftReport.
 * @throws         Error if the HTTP response is not 2xx, with message
 *                 `"ai-service scan failed: <status> <body>"`.
 */
export async function scanRepo(
  repoUrl: string,
  scanId: string
): Promise<RawAnalyzeResponse> {
  const baseUrl = process.env.FASTAPI_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "FASTAPI_BASE_URL is not set. Add it to your .env.local (see .env.example)."
    );
  }

  const res = await fetch(`${baseUrl}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: repoUrl, scan_id: scanId }),
    // next: { revalidate: 0 } — always fresh; scans are never idempotent
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ai-service scan failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<RawAnalyzeResponse>;
}
