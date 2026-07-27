# Accumulated Drift Score — How It Works

## The Credit Score Analogy

Each individual scan gives a **per-scan drift score**: a single number (0–100) that
says how risky the commits found in that scan are.

The **accumulated drift score** is like a credit score for the repository's security
health. Every risky scan nudges the score up (worse); time without new risky commits
nudges it down (better). Plot that number across time and you get a line graph:

> *"This repo's score was 20 in January, and it's 65 now — something went wrong in March."*

A single scan might look "medium risk" on its own, but if a repo has had
40 medium-risk scans in a row and nobody noticed, the accumulated score surfaces that
as a much bigger problem than any individual scan shows.

---

## The Decay Formula

```
accumulated = saturate( Σ  score_i × decay^(n − 1 − i) )
              for i = 0 … n-1   (oldest first)
```

Where:

| Symbol | Meaning |
|--------|---------|
| `score_i` | Per-scan drift score (0–100) for scan *i* |
| `decay` | `0.85` — the decay factor per scan |
| `n` | Total number of scans (including the newest) |
| `saturate(x)` | `100 × (1 − e^(−x/2.5))` — keeps result in 0–100 |

**Why 0.85?** Each scan "ages" to 85% of its previous weight. After 5 scans
(`0.85^5 ≈ 0.44`) an old score has roughly half the influence of a fresh one.
After 10 scans it's below 20%. This gives a **half-life of ≈5 scans** — old
risky commits fade but are never fully forgotten.

**Why the saturating curve?** Without it, 20 medium-risk scans (20 × 50 = 1000)
would wildly exceed the 0–100 range. `saturate(x) = 1 − e^(−x/2.5)` compresses
any sum into [0, 100] while preserving ordering: more risk → higher score, always.

### Example

Scan history (oldest → newest): `[30, 50, 70, 40, 80]`

```
weights  = [0.85^4, 0.85^3, 0.85^2, 0.85^1, 0.85^0]
         ≈ [0.522,  0.614,  0.723,  0.850,  1.000 ]

weighted_sum = (30×0.522 + 50×0.614 + 70×0.723 + 40×0.850 + 80×1.000) / 100
             ≈ (15.66 + 30.7 + 50.61 + 34.0 + 80.0) / 100
             ≈ 2.11

accumulated = 100 × (1 − e^(−2.11/2.5)) ≈ 57.1
```

Even though the latest scan alone is 80 (high risk), the accumulated score of ~57
reflects that the repository *started* at low risk and has been creeping up —
exactly the kind of trend the credit-score metaphor is meant to surface.

---

## Where Each Value Is Computed

| Location | What it does |
|----------|--------------|
| `ai-service/app/scoring.py` | `accumulated_drift_score(prior_scores, new_score)` — canonical Python implementation |
| `dashboard/lib/scan-engine.ts` | `accumulatedScore(priorScores, newScore)` — TypeScript mirror for local fallback |
| `ai-service/app/models.py` | `AnalyzeRequest.prior_scores` (forwarded from dashboard) |
| `ai-service/app/models.py` | `AnalyzeResponse.repo_score` (returned to dashboard) |
| `dashboard/lib/fastapi-client.ts` | Forwards `prior_scores` in POST body; reads `repo_score` from response |
| `dashboard/lib/map-analyze-response.ts` | Maps `repo_score` (÷ 100) into `MappedAnalysis.repo_score` |
| `dashboard/db/schema.ts` | `trend_points.score` — **stores the accumulated score** (not the raw per-scan score) |
| `dashboard/db/schema.ts` | `repos.latestDriftScore` — kept in sync with the latest trend point |

---

## How Trend Points Are Written

Each completed scan writes **one row** to the `trend_points` table:

```
date  = now()
score = accumulated_drift_score(all_prior_trend_point_scores, this_scan_drift_score)
```

The dashboard fetches all prior trend points **before** calling the ai-service, so
the ai-service can compute the accumulated score in one shot and return it as
`repo_score`. The scan engine then writes that value as the new trend point.

This means:
- The **trend chart** plots the compounding score over time — not disconnected per-scan scores.
- The **Repository Health Score** card shows the current accumulated value.
- Re-scanning a repo does **not** double-count history: the scan engine reads existing
  trend points and passes them as `prior_scores` each time.

---

## How to Read the Trend Chart

The trend analytics page (`/repos/:id/trend`) shows a **dual-series chart**:

| Line | Meaning |
|------|---------|
| Solid (primary colour) | Accumulated score — compounding history |
| Dashed (muted) | Per-scan estimate — isolated score for that scan only |

When the solid line is **significantly above** the dashed line, it means individual
scans look moderate but the repository has accumulated a risk burden over time.

The **Score Trajectory** card interprets the last 3-scan rolling average slope:

| Slope | Interpretation |
|-------|---------------|
| > +3%/scan | Accelerating — immediate attention needed |
| +0.5 to +3%/scan | Gradual increase — monitor closely |
| −0.5 to +0.5%/scan | Stable |
| −3 to −0.5%/scan | Gradually improving |
| < −3%/scan | Rapid improvement — remediation is working |