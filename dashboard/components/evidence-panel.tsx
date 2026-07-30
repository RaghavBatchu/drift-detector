"use client";

import React from "react";
import { Finding } from "@/types/contracts";
import { Sparkles, Terminal } from "lucide-react";
import { useReducedMotion } from "framer-motion";

interface EvidencePanelProps {
  finding: Finding;
}

export function EvidencePanel({ finding }: EvidencePanelProps) {
  const shouldReduceMotion = useReducedMotion();
  const isSimilarityOnly = !finding.evidence.rules || finding.evidence.rules.length === 0;

  return (
    <div className="p-6 space-y-6">
      {/* Severity Callouts & Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Rule Information */}
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">
            Detection Source
          </div>
          {isSimilarityOnly ? (
            /* Glowing Callout for Similarity Search */
            <div className="relative overflow-hidden rounded-lg border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 shadow-sm">
              <div className="flex items-start space-x-3">
                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5 animate-pulse" />
                <div>
                  <h4 className="font-bold text-xs text-primary">DriftGuard AI Search Match</h4>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Caught by semantic similarity, not a rule. Flagged by vector comparison to historical configuration vulnerability patterns.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Rule List Badges */
            <div className="flex flex-wrap gap-1.5">
              {finding.evidence.rules.map((rule) => (
                <span
                  key={rule}
                  className="inline-flex items-center px-2.5 py-1 rounded bg-muted border border-border text-[10px] font-bold font-mono text-foreground"
                >
                  Rule: {rule}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Indicators */}
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">
            Scan Metrics
          </div>
          <div className="flex items-center space-x-6 text-xs">
            <div className="space-y-1">
              <span className="text-muted-foreground block">Similarity Match</span>
              <span className="font-bold text-foreground">
                {finding.evidence.pattern_match && finding.evidence.pattern_match > 0
                  ? `${(finding.evidence.pattern_match * 100).toFixed(0)}%`
                  : !isSimilarityOnly
                  ? "Rule Match (Exact)"
                  : "N/A"}
              </span>
            </div>
            <div className="h-8 w-px bg-border/60" />
            <div className="space-y-1">
              <span className="text-muted-foreground block">AI Confidence</span>
              <span className="font-bold text-foreground">
                {(finding.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Diff Output */}
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" /> Evidence Diff
        </div>
        <div className="font-mono text-xs rounded-lg bg-zinc-950 p-4 border border-zinc-800 text-zinc-300 space-y-1 overflow-x-auto shadow-inner select-text">
          {finding.evidence.removed && finding.evidence.removed.length > 0 && (
            <div className="space-y-0.5">
              {finding.evidence.removed.map((line, i) => (
                <div
                  key={`rem-${i}`}
                  className="text-rose-400 bg-rose-950/20 px-2 py-0.5 rounded border-l-2 border-rose-500 line-through whitespace-pre"
                >
                  - {line}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-0.5">
            {finding.evidence.added.map((line, i) => (
              <div
                key={`add-${i}`}
                className="text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded border-l-2 border-emerald-500 whitespace-pre"
              >
                + {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detailed Explanations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        <div className="space-y-1.5">
          <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
            Impact Analysis
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {finding.explanation}
          </p>
        </div>
        <div className="space-y-1.5">
          <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
            Remediation Protocol
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {finding.remediation}
          </p>
        </div>
      </div>
    </div>
  );
}
