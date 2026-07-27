/**
 * Unit tests for lib/map-analyze-response.ts
 *
 * All tests are pure (no I/O, no network) — they build hand-written
 * RawAnalyzeResponse / RawFinding fixtures that mirror the ai-service
 * wire format and assert on the mapped output shape.
 *
 * Test surface:
 *  - Severity casing (CRITICAL → critical)
 *  - Score scaling (risk_score / 100, drift_score / 100)
 *  - Rule-only vs semantic-only evidence routing
 *  - evidence_side bucketing (the "everything defaults to green" regression)
 *  - Sparse summary defaulting (missing LOW key → 0)
 *  - Zero-findings / clean-scan case
 *  - Field renames (file_path → file, commit_hash → commit, commit_date → timestamp)
 */

import { describe, it, expect } from "vitest";
import { mapAnalyzeResponse } from "@/lib/map-analyze-response";
import type { RawAnalyzeResponse, RawFinding } from "@/lib/fastapi-client";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal valid RawFinding with every required field. Override per-test. */
function makeRawFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    file_path: "src/api/auth.ts",
    commit_hash: "abc123",
    commit_date: "2024-01-15T10:00:00Z",
    severity: "HIGH",
    risk_score: 50.0,
    confidence: 0.85,
    rule_id: "AUTH-001",
    rule_name: "Hardcoded secret",
    category: "security",
    evidence: ["const secret = 'hunter2';"],
    matched_by: "rule",
    nearest_pattern: null,
    similarity: null,
    explanation: "A hardcoded secret was detected.",
    remediation: "Use environment variables.",
    author: "alice",
    change_summary: "Added auth module",
    evidence_side: "added",
    ...overrides,
  };
}

/** Minimal valid RawAnalyzeResponse wrapping zero or more findings. */
function makeRawResponse(
  overrides: Partial<RawAnalyzeResponse> = {},
  findings: RawFinding[] = []
): RawAnalyzeResponse {
  return {
    repo_id: "test-repo",
    drift_score: 75.2,
    repo_score: 65.0,
    risk_trend: [],
    summary: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
    findings,
    analyzed_changes: 42,
    engine_info: { version: "1.0.0" },
    trend_alert: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Severity casing
// ---------------------------------------------------------------------------

describe("severity casing", () => {
  it.each([
    ["CRITICAL", "critical"],
    ["HIGH", "high"],
    ["MEDIUM", "medium"],
    ["LOW", "low"],
  ] as const)("maps %s → %s", (rawSev, expectedSev) => {
    const raw = makeRawResponse({}, [makeRawFinding({ severity: rawSev })]);
    const { findings } = mapAnalyzeResponse(raw);
    expect(findings[0].severity).toBe(expectedSev);
  });
});

// ---------------------------------------------------------------------------
// Score scaling (0–100 → 0–1)
// ---------------------------------------------------------------------------

describe("score scaling", () => {
  it("maps risk_score 74.1 to score 0.741", () => {
    const raw = makeRawResponse({}, [makeRawFinding({ risk_score: 74.1 })]);
    const { findings } = mapAnalyzeResponse(raw);
    expect(findings[0].score).toBeCloseTo(0.741, 10);
  });

  it("maps drift_score 75.2 to drift_score 0.752", () => {
    const raw = makeRawResponse({ drift_score: 75.2 });
    const { drift_score } = mapAnalyzeResponse(raw);
    expect(drift_score).toBeCloseTo(0.752, 10);
  });

  it("maps risk_score 0 to score 0", () => {
    const raw = makeRawResponse({}, [makeRawFinding({ risk_score: 0 })]);
    expect(mapAnalyzeResponse(raw).findings[0].score).toBe(0);
  });

  it("maps risk_score 100 to score 1", () => {
    const raw = makeRawResponse({}, [makeRawFinding({ risk_score: 100 })]);
    expect(mapAnalyzeResponse(raw).findings[0].score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// evidence.rules — rule-only vs semantic-only
// ---------------------------------------------------------------------------

describe("evidence.rules", () => {
  it("rule-only finding: rule_id 'NET-002' → evidence.rules = ['NET-002']", () => {
    const raw = makeRawResponse({}, [makeRawFinding({ rule_id: "NET-002" })]);
    const { findings } = mapAnalyzeResponse(raw);
    expect(findings[0].evidence.rules).toEqual(["NET-002"]);
  });

  it("semantic-only finding: rule_id null → evidence.rules = []", () => {
    const raw = makeRawResponse({}, [makeRawFinding({ rule_id: null })]);
    const { findings } = mapAnalyzeResponse(raw);
    expect(findings[0].evidence.rules).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// evidence.pattern_match — similarity null-coalescing
// ---------------------------------------------------------------------------

describe("evidence.pattern_match", () => {
  it("similarity null → pattern_match 0 (not null or undefined)", () => {
    const raw = makeRawResponse({}, [makeRawFinding({ similarity: null })]);
    const { findings } = mapAnalyzeResponse(raw);
    const pm = findings[0].evidence.pattern_match;
    expect(pm).toBe(0);
    expect(typeof pm).toBe("number");
  });

  it("similarity 0.93 → pattern_match 0.93", () => {
    const raw = makeRawResponse({}, [makeRawFinding({ similarity: 0.93 })]);
    const { findings } = mapAnalyzeResponse(raw);
    expect(findings[0].evidence.pattern_match).toBeCloseTo(0.93, 10);
  });

  it("similarity 0 → pattern_match 0 (zero is preserved, not treated as falsy)", () => {
    const raw = makeRawResponse({}, [makeRawFinding({ similarity: 0 })]);
    const { findings } = mapAnalyzeResponse(raw);
    expect(findings[0].evidence.pattern_match).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evidence_side bucketing — the "everything defaults to green" regression test
// ---------------------------------------------------------------------------

describe("evidence_side bucketing", () => {
  const evidenceLines = ["- const TOKEN = 'abc';", "- export { TOKEN };"];

  it(
    "evidence_side 'removed': lines go into evidence.removed, evidence.added is empty []",
    () => {
      const raw = makeRawResponse({}, [
        makeRawFinding({ evidence: evidenceLines, evidence_side: "removed" }),
      ]);
      const { findings } = mapAnalyzeResponse(raw);
      const ev = findings[0].evidence;

      // The critical assertion — wrong default would put everything in .added
      expect(ev.removed).toEqual(evidenceLines);
      expect(ev.added).toEqual([]);
    }
  );

  it(
    "evidence_side 'added': lines go into evidence.added, evidence.removed is empty []",
    () => {
      const addedLines = ["+ const TOKEN = process.env.TOKEN;"];
      const raw = makeRawResponse({}, [
        makeRawFinding({ evidence: addedLines, evidence_side: "added" }),
      ]);
      const { findings } = mapAnalyzeResponse(raw);
      const ev = findings[0].evidence;

      expect(ev.added).toEqual(addedLines);
      expect(ev.removed).toEqual([]);
    }
  );

  it("unrecognised evidence_side defaults to 'added' (defensive fallback)", () => {
    const lines = ["some line"];
    const raw = makeRawResponse({}, [
      makeRawFinding({ evidence: lines, evidence_side: "context" }),
    ]);
    const { findings } = mapAnalyzeResponse(raw);
    const ev = findings[0].evidence;

    expect(ev.added).toEqual(lines);
    expect(ev.removed).toEqual([]);
  });

  it("both buckets are always arrays (never undefined)", () => {
    const raw = makeRawResponse({}, [
      makeRawFinding({ evidence: ["x"], evidence_side: "removed" }),
    ]);
    const ev = mapAnalyzeResponse(raw).findings[0].evidence;

    expect(Array.isArray(ev.added)).toBe(true);
    expect(Array.isArray(ev.removed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sparse summary defaulting
// ---------------------------------------------------------------------------

describe("sparse summary defaulting", () => {
  it("missing LOW key → summary.low === 0, not undefined", () => {
    const raw = makeRawResponse({
      // Simulate a scan with no low-severity findings — 'LOW' key absent
      summary: { CRITICAL: 1, HIGH: 2 } as RawAnalyzeResponse["summary"],
    });
    const { summary } = mapAnalyzeResponse(raw);

    expect(summary.low).toBe(0);
    expect(typeof summary.low).toBe("number");
  });

  it("missing MEDIUM and LOW → both default to 0", () => {
    const raw = makeRawResponse({
      summary: { CRITICAL: 3 } as RawAnalyzeResponse["summary"],
    });
    const { summary } = mapAnalyzeResponse(raw);

    expect(summary.medium).toBe(0);
    expect(summary.low).toBe(0);
  });

  it("all four severity keys present → values pass through exactly", () => {
    const raw = makeRawResponse({
      summary: { CRITICAL: 5, HIGH: 3, MEDIUM: 8, LOW: 1 },
    });
    const { summary } = mapAnalyzeResponse(raw);

    expect(summary.critical).toBe(5);
    expect(summary.high).toBe(3);
    expect(summary.medium).toBe(8);
    expect(summary.low).toBe(1);
  });

  it("analyzed_changes maps to summary.changes_scanned", () => {
    const raw = makeRawResponse({ analyzed_changes: 99 });
    const { summary } = mapAnalyzeResponse(raw);
    expect(summary.changes_scanned).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Zero findings — clean scan
// ---------------------------------------------------------------------------

describe("zero findings (clean scan)", () => {
  it("findings: [] → findings: []", () => {
    const raw = makeRawResponse({ findings: [] }, []);
    expect(mapAnalyzeResponse(raw).findings).toEqual([]);
  });

  it("zero findings with empty summary → all counts are 0", () => {
    const raw = makeRawResponse({
      findings: [],
      summary: {} as RawAnalyzeResponse["summary"],
      analyzed_changes: 0,
      drift_score: 0,
    });
    const { summary, drift_score } = mapAnalyzeResponse(raw);

    expect(summary.critical).toBe(0);
    expect(summary.high).toBe(0);
    expect(summary.medium).toBe(0);
    expect(summary.low).toBe(0);
    expect(summary.changes_scanned).toBe(0);
    expect(drift_score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Field renames / pass-throughs
// ---------------------------------------------------------------------------

describe("field renames", () => {
  const rawFinding = makeRawFinding({
    file_path: "src/lib/db.ts",
    commit_hash: "deadbeef",
    commit_date: "2024-06-01T09:30:00Z",
    author: "bob",
    change_summary: "Refactored DB layer",
  });

  it("file_path → file", () => {
    const { findings } = mapAnalyzeResponse(makeRawResponse({}, [rawFinding]));
    expect(findings[0].file).toBe("src/lib/db.ts");
  });

  it("commit_hash → commit", () => {
    const { findings } = mapAnalyzeResponse(makeRawResponse({}, [rawFinding]));
    expect(findings[0].commit).toBe("deadbeef");
  });

  it("commit_date → timestamp", () => {
    const { findings } = mapAnalyzeResponse(makeRawResponse({}, [rawFinding]));
    expect(findings[0].timestamp).toBe("2024-06-01T09:30:00Z");
  });

  it("author passes through with no transformation", () => {
    const { findings } = mapAnalyzeResponse(makeRawResponse({}, [rawFinding]));
    expect(findings[0].author).toBe("bob");
  });

  it("change_summary passes through with no transformation", () => {
    const { findings } = mapAnalyzeResponse(makeRawResponse({}, [rawFinding]));
    expect(findings[0].change_summary).toBe("Refactored DB layer");
  });

  it("risk_trend is discarded — mapAnalyzeResponse does not expose it", () => {
    const raw = makeRawResponse({
      risk_trend: [{ date: "2024-01-01", cumulative_drift: 42 }],
    });
    const result = mapAnalyzeResponse(raw);
    // MappedAnalysis has no risk_trend field
    expect("risk_trend" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Derived finding ID — stable across re-renders / re-scans
// ---------------------------------------------------------------------------

describe("derived finding id", () => {
  it("id is deterministic: same input always produces the same id", () => {
    const raw = makeRawResponse({}, [
      makeRawFinding({ commit_hash: "c0ffee", file_path: "a.ts", rule_id: "R1" }),
    ]);
    const r1 = mapAnalyzeResponse(raw).findings[0].id;
    const r2 = mapAnalyzeResponse(raw).findings[0].id;
    expect(r1).toBe(r2);
  });

  it("id encodes commit_hash, file_path, and rule_id", () => {
    const raw = makeRawResponse({}, [
      makeRawFinding({ commit_hash: "c0ffee", file_path: "a.ts", rule_id: "R1" }),
    ]);
    const { id } = mapAnalyzeResponse(raw).findings[0];
    expect(id).toContain("c0ffee");
    expect(id).toContain("a.ts");
    expect(id).toContain("R1");
  });

  it("semantic finding (rule_id null) uses 'semantic' sentinel in id", () => {
    const raw = makeRawResponse({}, [
      makeRawFinding({ commit_hash: "c0ffee", file_path: "b.ts", rule_id: null }),
    ]);
    const { id } = mapAnalyzeResponse(raw).findings[0];
    expect(id).toContain("semantic");
  });

  it("two findings with different rule_ids get different ids", () => {
    const raw = makeRawResponse({}, [
      makeRawFinding({ rule_id: "R1" }),
      makeRawFinding({ rule_id: "R2" }),
    ]);
    const [f1, f2] = mapAnalyzeResponse(raw).findings;
    expect(f1.id).not.toBe(f2.id);
  });
});

// ---------------------------------------------------------------------------
// Multiple findings — mapping is applied to all
// ---------------------------------------------------------------------------

describe("multiple findings", () => {
  it("all findings are mapped, preserving order", () => {
    const raw = makeRawResponse({}, [
      makeRawFinding({ severity: "CRITICAL", risk_score: 90, file_path: "a.ts" }),
      makeRawFinding({ severity: "LOW", risk_score: 10, file_path: "b.ts" }),
    ]);
    const { findings } = mapAnalyzeResponse(raw);

    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].score).toBeCloseTo(0.9, 10);
    expect(findings[0].file).toBe("a.ts");

    expect(findings[1].severity).toBe("low");
    expect(findings[1].score).toBeCloseTo(0.1, 10);
    expect(findings[1].file).toBe("b.ts");
  });
});

// ---------------------------------------------------------------------------
// Feature 6: trend_alert pass-through
// ---------------------------------------------------------------------------

/** Minimal valid RawTrendAlert fixture. */
function makeRawTrendAlert(overrides: Partial<import("@/lib/fastapi-client").RawTrendAlert> = {}) {
  return {
    fired: true as const,
    score_start: 20.0,
    score_end: 42.0,
    delta: 22.0,
    window_days: 30,
    threshold: 15.0,
    points_in_window: 3,
    confidence: 0.71,
    message: "Accumulated drift score rose +22.0 points over the last 30 days.",
    ...overrides,
  };
}

describe("trend_alert mapping (Feature 6)", () => {
  it("trend_alert null in raw response → null in mapped output", () => {
    const raw = makeRawResponse({ trend_alert: null });
    const { trend_alert } = mapAnalyzeResponse(raw);
    expect(trend_alert).toBeNull();
  });

  it("trend_alert absent (undefined) → coerced to null in mapped output", () => {
    // Simulate older ai-service that doesn't include the field
    const raw = makeRawResponse({});
    delete (raw as any).trend_alert;
    const { trend_alert } = mapAnalyzeResponse(raw);
    expect(trend_alert).toBeNull();
  });

  it("trend_alert with fired=true passes through with correct shape", () => {
    const rawAlert = makeRawTrendAlert();
    const raw = makeRawResponse({ trend_alert: rawAlert });
    const { trend_alert } = mapAnalyzeResponse(raw);

    expect(trend_alert).not.toBeNull();
    expect(trend_alert!.fired).toBe(true);
    expect(trend_alert!.delta).toBe(22.0);
    expect(trend_alert!.score_start).toBe(20.0);
    expect(trend_alert!.score_end).toBe(42.0);
    expect(trend_alert!.window_days).toBe(30);
    expect(trend_alert!.threshold).toBe(15.0);
    expect(trend_alert!.points_in_window).toBe(3);
    expect(trend_alert!.confidence).toBe(0.71);
    expect(typeof trend_alert!.message).toBe("string");
  });

  it("trend_alert scores are NOT divided by 100 (they stay on 0-100 scale)", () => {
    // Unlike drift_score / risk_score which are ÷100, trend_alert scores
    // represent raw accumulated scores stored in trend_points and must NOT
    // be transformed.
    const rawAlert = makeRawTrendAlert({ score_start: 25.5, score_end: 48.0 });
    const raw = makeRawResponse({ trend_alert: rawAlert });
    const { trend_alert } = mapAnalyzeResponse(raw);

    // Must remain on 0-100 scale
    expect(trend_alert!.score_start).toBe(25.5);
    expect(trend_alert!.score_end).toBe(48.0);
  });

  it("trend_alert with custom window and threshold preserves those values", () => {
    const rawAlert = makeRawTrendAlert({ window_days: 7, threshold: 8.0 });
    const raw = makeRawResponse({ trend_alert: rawAlert });
    const { trend_alert } = mapAnalyzeResponse(raw);

    expect(trend_alert!.window_days).toBe(7);
    expect(trend_alert!.threshold).toBe(8.0);
  });
});
