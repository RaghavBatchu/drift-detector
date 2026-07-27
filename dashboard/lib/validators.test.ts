/**
 * Unit tests for lib/validators.ts
 *
 * Verifies that the Zod schemas correctly:
 *   - Accept the exact output shape produced by map-analyze-response.ts (Commit 2's mapper)
 *   - Reject malformed inputs with descriptive failures
 *
 * All fixtures are hand-built to mirror the *dashboard* internal types
 * (Finding, DriftReport, RepoSummary) — not the raw ai-service wire format.
 *
 * Test surface:
 *   - FindingSchema: round-trip success, rejection of bad severity / missing
 *     required field, optional evidence.removed
 *   - DriftReportSchema: round-trip success, rejection of wrong type on summary.critical
 *   - RepoSummarySchema: round-trip success
 *   - ScanStatusSchema: all six real values pass; "complete" (off-by-one typo) fails
 */

import { describe, it, expect } from "vitest";
import {
  FindingSchema,
  DriftReportSchema,
  RepoSummarySchema,
  ScanStatusSchema,
} from "@/lib/validators";
import type { Finding, DriftReport, RepoSummary } from "@/types/contracts";

// ---------------------------------------------------------------------------
// Fixture helpers — the output shape from Commit 2's mapper
// ---------------------------------------------------------------------------

/**
 * A fully-populated Finding exactly as mapFinding() would produce it.
 * Override per-test with spread or Object.assign.
 */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "abc123::src/api/auth.ts::AUTH-001",
    file: "src/api/auth.ts",
    commit: "abc123",
    author: "alice",
    timestamp: "2024-01-15T10:00:00Z",
    severity: "high",
    score: 0.741,
    confidence: 0.85,
    change_summary: "Added auth module with hardcoded secret",
    evidence: {
      added: ["const secret = 'hunter2';"],
      removed: ["const secret = process.env.SECRET;"],
      rules: ["AUTH-001"],
      pattern_match: 0.93,
    },
    explanation: "A hardcoded secret was detected in the auth module.",
    remediation: "Replace the hardcoded value with an environment variable.",
    ...overrides,
  };
}

/**
 * A fully-populated DriftReport as the dashboard assembles it after scanning.
 */
function makeDriftReport(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    repo: "github.com/acme/api",
    drift_score: 0.752,
    repo_accumulated_score: 0.65,
    summary: {
      changes_scanned: 42,
      critical: 1,
      high: 3,
      medium: 5,
      low: 2,
    },
    findings: [makeFinding()],
    trend: [
      { date: "2024-01-10", score: 0.5 },
      { date: "2024-01-15", score: 0.752 },
    ],
    trend_alert: null,
    ...overrides,
  };
}

/**
 * A fully-populated RepoSummary as returned from the DB layer.
 */
function makeRepoSummary(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: "repo-abc123",
    url: "https://github.com/acme/api",
    name: "acme/api",
    last_scan_at: "2024-01-15T10:00:00Z",
    latest_drift_score: 0.752,
    repo_accumulated_score: 0.65,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FindingSchema — round-trip
// ---------------------------------------------------------------------------

describe("FindingSchema — round-trip", () => {
  it("accepts a fully-populated Finding produced by the mapper", () => {
    const result = FindingSchema.safeParse(makeFinding());
    expect(result.success).toBe(true);
  });

  it("accepts all four valid severity values", () => {
    for (const severity of ["critical", "high", "medium", "low"] as const) {
      const result = FindingSchema.safeParse(makeFinding({ severity }));
      expect(result.success).toBe(
        true,
        `Expected severity "${severity}" to be accepted`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// FindingSchema — rejection cases
// ---------------------------------------------------------------------------

describe("FindingSchema — rejection", () => {
  it("rejects uppercase severity 'CRITICAL' (raw ai-service value, mapper must lower-case first)", () => {
    const finding = makeFinding({ severity: "CRITICAL" as never });
    const result = FindingSchema.safeParse(finding);
    expect(result.success).toBe(false);
  });

  it("rejects uppercase severity 'HIGH'", () => {
    const finding = makeFinding({ severity: "HIGH" as never });
    const result = FindingSchema.safeParse(finding);
    expect(result.success).toBe(false);
  });

  it("rejects a completely unknown severity value", () => {
    const finding = makeFinding({ severity: "blocker" as never });
    const result = FindingSchema.safeParse(finding);
    expect(result.success).toBe(false);
  });

  it("rejects a Finding with change_summary missing", () => {
    const { change_summary: _omitted, ...withoutSummary } = makeFinding();
    const result = FindingSchema.safeParse(withoutSummary);
    expect(result.success).toBe(false);
  });

  it("rejects a Finding with the 'file' field missing", () => {
    const { file: _omitted, ...withoutFile } = makeFinding();
    const result = FindingSchema.safeParse(withoutFile);
    expect(result.success).toBe(false);
  });

  it("rejects a Finding where score is a string instead of a number", () => {
    const result = FindingSchema.safeParse(
      makeFinding({ score: "0.741" as never })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a Finding where evidence.pattern_match is missing", () => {
    const finding = makeFinding();
    const { pattern_match: _omitted, ...evidenceWithoutPM } = finding.evidence;
    const result = FindingSchema.safeParse({
      ...finding,
      evidence: evidenceWithoutPM,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FindingSchema — evidence.removed is optional
// ---------------------------------------------------------------------------

describe("FindingSchema — evidence.removed is optional", () => {
  it("accepts a Finding where evidence.removed is omitted entirely", () => {
    const finding = makeFinding();
    // Remove the optional field — not every finding will have removed-side evidence
    const { removed: _omitted, ...evidenceWithoutRemoved } = finding.evidence;
    const result = FindingSchema.safeParse({
      ...finding,
      evidence: evidenceWithoutRemoved,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a Finding where evidence.removed is an empty array []", () => {
    // The mapper always emits [] for the inactive bucket — this must still pass
    const finding = makeFinding({
      evidence: { ...makeFinding().evidence, removed: [] },
    });
    const result = FindingSchema.safeParse(finding);
    expect(result.success).toBe(true);
  });

  it("accepts a Finding where evidence.removed is a populated array", () => {
    const finding = makeFinding({
      evidence: {
        ...makeFinding().evidence,
        removed: ["- const TOKEN = 'abc';"],
      },
    });
    const result = FindingSchema.safeParse(finding);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DriftReportSchema — round-trip
// ---------------------------------------------------------------------------

describe("DriftReportSchema — round-trip", () => {
  it("accepts a fully-populated DriftReport", () => {
    const result = DriftReportSchema.safeParse(makeDriftReport());
    expect(result.success).toBe(true);
  });

  it("accepts a DriftReport with an empty findings array (clean scan)", () => {
    const result = DriftReportSchema.safeParse(
      makeDriftReport({ findings: [], trend: [] })
    );
    expect(result.success).toBe(true);
  });

  it("accepts a DriftReport with multiple findings", () => {
    const result = DriftReportSchema.safeParse(
      makeDriftReport({
        findings: [
          makeFinding({ severity: "critical", score: 0.9 }),
          makeFinding({ severity: "low", score: 0.1 }),
        ],
      })
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DriftReportSchema — rejection cases
// ---------------------------------------------------------------------------

describe("DriftReportSchema — rejection", () => {
  it("rejects when summary.critical is a string instead of a number", () => {
    const report = makeDriftReport();
    const result = DriftReportSchema.safeParse({
      ...report,
      summary: { ...report.summary, critical: "1" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when summary.high is missing", () => {
    const report = makeDriftReport();
    const { high: _omitted, ...summaryWithoutHigh } = report.summary;
    const result = DriftReportSchema.safeParse({
      ...report,
      summary: summaryWithoutHigh,
    });
    expect(result.success).toBe(false);
  });

  it("rejects when drift_score is missing", () => {
    const { drift_score: _omitted, ...withoutScore } = makeDriftReport();
    const result = DriftReportSchema.safeParse(withoutScore);
    expect(result.success).toBe(false);
  });

  it("rejects when a finding inside findings[] has an invalid severity", () => {
    const result = DriftReportSchema.safeParse(
      makeDriftReport({
        findings: [makeFinding({ severity: "CRITICAL" as never })],
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects when trend entries have score as a string", () => {
    const result = DriftReportSchema.safeParse(
      makeDriftReport({
        trend: [{ date: "2024-01-10", score: "0.5" as never }],
      })
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RepoSummarySchema — round-trip
// ---------------------------------------------------------------------------

describe("RepoSummarySchema — round-trip", () => {
  it("accepts a fully-populated RepoSummary", () => {
    const result = RepoSummarySchema.safeParse(makeRepoSummary());
    expect(result.success).toBe(true);
  });

  it("accepts a RepoSummary where last_scan_at is null (never scanned)", () => {
    const result = RepoSummarySchema.safeParse(
      makeRepoSummary({ last_scan_at: null })
    );
    expect(result.success).toBe(true);
  });

  it("accepts a RepoSummary where latest_drift_score is null (no score yet)", () => {
    const result = RepoSummarySchema.safeParse(
      makeRepoSummary({ latest_drift_score: null })
    );
    expect(result.success).toBe(true);
  });

  it("accepts a RepoSummary where both nullable fields are null", () => {
    const result = RepoSummarySchema.safeParse(
      makeRepoSummary({ last_scan_at: null, latest_drift_score: null })
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ScanStatusSchema — all six valid values
// ---------------------------------------------------------------------------

describe("ScanStatusSchema — valid values", () => {
  it.each([
    "queued",
    "cloning",
    "mining",
    "analyzing",
    "completed",
    "failed",
  ] as const)('"%s" is a valid ScanStatus', (status) => {
    const result = ScanStatusSchema.safeParse(status);
    expect(result.success).toBe(
      true,
      `Expected ScanStatus "${status}" to be accepted`
    );
  });
});

// ---------------------------------------------------------------------------
// ScanStatusSchema — rejection cases
// ---------------------------------------------------------------------------

describe("ScanStatusSchema — rejection", () => {
  it(
    '"complete" (missing the "d") correctly fails — the exact off-by-one-letter typo',
    () => {
      // "complete" vs "completed" is an easy mistype; the schema must catch it
      const result = ScanStatusSchema.safeParse("complete");
      expect(result.success).toBe(false);
    }
  );

  it('"COMPLETED" (uppercase) fails', () => {
    const result = ScanStatusSchema.safeParse("COMPLETED");
    expect(result.success).toBe(false);
  });

  it('"done" fails', () => {
    const result = ScanStatusSchema.safeParse("done");
    expect(result.success).toBe(false);
  });

  it('"running" fails', () => {
    const result = ScanStatusSchema.safeParse("running");
    expect(result.success).toBe(false);
  });

  it("empty string fails", () => {
    const result = ScanStatusSchema.safeParse("");
    expect(result.success).toBe(false);
  });
});
