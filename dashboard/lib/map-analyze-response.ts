/**
 * Pure mapping layer between the ai-service wire format and the
 * dashboard's internal types.
 *
 * This function has zero side-effects and zero I/O — it can be
 * unit-tested against hand-written fixtures independently of both
 * services actually running (see Commit 4's pattern for fixture helpers).
 *
 * Mapping table
 * ─────────────────────────────────────────────────────────────────────────
 * Raw field (RawAnalyzeResponse)       Dashboard field        Rule
 * ─────────────────────────────────────────────────────────────────────────
 * finding.severity                     severity               .toLowerCase()
 * finding.risk_score                   score                  / 100  (0–100 → 0–1)
 * raw.drift_score                      drift_score            / 100
 * finding.rule_id                      evidence.rules         rule_id ? [rule_id] : []
 * finding.similarity                   evidence.pattern_match similarity ?? 0
 * finding.evidence + evidence_side     evidence.added/removed bucket flat[] by side
 * finding.file_path                    file                   rename
 * finding.commit_hash                  commit                 rename
 * finding.commit_date                  timestamp              rename
 * finding.author                       author                 direct
 * finding.change_summary               change_summary         direct
 * raw.analyzed_changes                 summary.changes_scanned rename
 * raw.summary (UPPERCASE, sparse)      summary.*              lowercase keys; missing → 0
 * raw.risk_trend                       (discarded)            dashboard builds its own
 *                                                             trend_points per completed scan
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Finding, ReportSummary } from "@/types/contracts";
import type { RawAnalyzeResponse, RawFinding, RawSeverity } from "@/lib/fastapi-client";

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface MappedAnalysis {
  findings: Finding[];
  summary: ReportSummary;
  /** 0–1 (divided by 100 from ai-service's 0–100 scale). */
  drift_score: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** "CRITICAL" → "critical", etc. Type-safe downcast. */
function mapSeverity(raw: RawSeverity): Finding["severity"] {
  return raw.toLowerCase() as Finding["severity"];
}

/**
 * Build a stable, collision-resistant ID from the fields available on a
 * raw finding. The ai-service has no UUID — we derive one deterministically
 * so React list keys and DB upserts stay stable across re-renders/re-scans.
 */
function deriveFindingId(raw: RawFinding): string {
  return `${raw.commit_hash}::${raw.file_path}::${raw.rule_id ?? "semantic"}`;
}

/**
 * Bucket a flat evidence string[] by the side that triggered the finding.
 *
 * ai-service emits a single flat `evidence` array (the exact lines that
 * fired the rule or semantic match) plus `evidence_side` ("added" |
 * "removed") telling us which diff direction it came from.
 *
 * The dashboard's Finding.evidence shape wants separate added/removed buckets,
 * so we put the whole flat array into the correct bucket and leave the other
 * empty (not undefined — the dashboard renders both and needs an array).
 */
function mapEvidence(
  lines: string[],
  side: string
): { added: string[]; removed: string[] } {
  if (side === "removed") {
    return { added: [], removed: lines };
  }
  // Default to "added" for any unrecognised value (defensive).
  return { added: lines, removed: [] };
}

// ---------------------------------------------------------------------------
// Per-finding mapper
// ---------------------------------------------------------------------------

function mapFinding(raw: RawFinding): Finding {
  const { added, removed } = mapEvidence(raw.evidence, raw.evidence_side);

  return {
    id: deriveFindingId(raw),
    // Renames
    file: raw.file_path,
    commit: raw.commit_hash,
    timestamp: raw.commit_date,
    // Direct pass-throughs
    author: raw.author,
    change_summary: raw.change_summary,
    explanation: raw.explanation,
    remediation: raw.remediation,
    confidence: raw.confidence,
    // Transformations
    severity: mapSeverity(raw.severity),
    score: raw.risk_score / 100,           // 0–100 → 0–1
    evidence: {
      added,
      removed,                              // present but may be []
      rules: raw.rule_id ? [raw.rule_id] : [],
      pattern_match: raw.similarity ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Summary mapper
// ---------------------------------------------------------------------------

/**
 * The ai-service emits a sparse summary keyed by UPPERCASE severity.
 * A "clean" band (zero findings of that severity) is simply absent from
 * the response — we default it to 0 so callers never have to guard.
 */
function mapSummary(
  rawSummary: Record<RawSeverity, number>,
  analyzedChanges: number
): ReportSummary {
  return {
    changes_scanned: analyzedChanges,
    critical: rawSummary["CRITICAL"] ?? 0,
    high: rawSummary["HIGH"] ?? 0,
    medium: rawSummary["MEDIUM"] ?? 0,
    low: rawSummary["LOW"] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a raw ai-service response into the dashboard's internal shape.
 *
 * Pure function — no I/O, no side-effects. Safe to call in tests with
 * hand-crafted fixtures.
 *
 * Note: `raw.risk_trend` is intentionally discarded. The dashboard stores
 * its own `trend_points` table (one row per completed scan) derived from the
 * mapped `drift_score` written back by the scan runner (Commit 7). Using
 * ai-service's cumulative-per-commit trend would double-count on re-scans.
 */
export function mapAnalyzeResponse(raw: RawAnalyzeResponse): MappedAnalysis {
  return {
    findings: raw.findings.map(mapFinding),
    summary: mapSummary(raw.summary, raw.analyzed_changes),
    drift_score: raw.drift_score / 100,    // 0–100 → 0–1
  };
}
