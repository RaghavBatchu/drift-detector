import React, { useState, useMemo } from "react";
import { Finding, Severity } from "@/types/contracts";
import { SeverityBadge } from "@/components/severity-badge";
import { EvidencePanel } from "@/components/evidence-panel";
import { ReviewModal } from "@/components/review-modal";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Search,
  ShieldCheck,
  MessageSquareWarning,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface FindingsTableProps {
  findings: Finding[];
  repoId?: string;
}

export function FindingsTable({ findings, repoId = "" }: FindingsTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [selectedFileType, setSelectedFileType] = useState<string>("all");
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);
  const [reviewFinding, setReviewFinding] = useState<Finding | null>(null);

  const shouldReduceMotion = useReducedMotion();

  // Helper: Extract File extension/type
  const getFileType = (filepath: string) => {
    const filename = filepath.split("/").pop() || "";
    if (filename.toLowerCase() === "dockerfile") return "Dockerfile";
    if (filename.startsWith(".")) return filename;
    const ext = filename.split(".").pop();
    return ext ? `.${ext.toLowerCase()}` : "Other";
  };

  // Derive all unique file types dynamically from findings
  const uniqueFileTypes = useMemo(() => {
    const types = new Set<string>();
    findings.forEach((f) => {
      types.add(getFileType(f.file));
    });
    return Array.from(types).sort();
  }, [findings]);

  // Count severity for badge categories
  const severityCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach((f) => {
      if (f.severity in counts) {
        counts[f.severity as keyof typeof counts]++;
      }
    });
    return counts;
  }, [findings]);

  // Filter & Sort Findings
  const processedFindings = useMemo(() => {
    let list = [...findings];

    // 1. Search Query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (f) =>
          f.file.toLowerCase().includes(query) ||
          f.change_summary.toLowerCase().includes(query) ||
          f.commit.toLowerCase().includes(query)
      );
    }

    // 2. Severity Filter
    if (selectedSeverity !== "all") {
      list = list.filter((f) => f.severity === selectedSeverity);
    }

    // 3. File Type Filter
    if (selectedFileType !== "all") {
      list = list.filter((f) => getFileType(f.file) === selectedFileType);
    }

    // 4. Default Sorting (Severity: Critical > High > Medium > Low, then by Score descending)
    const severityWeight: Record<Severity, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    list.sort((a, b) => {
      const weightA = severityWeight[a.severity] || 0;
      const weightB = severityWeight[b.severity] || 0;
      if (weightA !== weightB) {
        return weightB - weightA;
      }
      return b.score - a.score;
    });

    return list;
  }, [findings, searchQuery, selectedSeverity, selectedFileType]);

  return (
    <div className="space-y-4">
      {/* Filters Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5.5 w-5.5 text-primary" /> Fired Findings
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drift details flagged by rules engine and similarity matching.
          </p>
        </div>

        {/* Filtering Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search query input */}
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search findings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-background border border-border rounded-md pl-9 pr-4 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
            />
          </div>

          {/* File Type filter dropdown */}
          <select
            value={selectedFileType}
            onChange={(e) => setSelectedFileType(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
          >
            <option value="all">All File Types</option>
            {uniqueFileTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab-based Severity Selector */}
      <div className="flex flex-wrap gap-1.5 bg-muted/40 p-1 border border-border/60 rounded-lg max-w-max">
        {[
          { value: "all", label: `All (${findings.length})` },
          { value: "critical", label: `Critical (${severityCounts.critical})` },
          { value: "high", label: `High (${severityCounts.high})` },
          { value: "medium", label: `Medium (${severityCounts.medium})` },
          { value: "low", label: `Low (${severityCounts.low})` },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setSelectedSeverity(tab.value)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer select-none ${
              selectedSeverity === tab.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Findings List */}
      <div className="space-y-4 pt-2">
        {processedFindings.length === 0 ? (
          <div className="p-8 border border-dashed border-border/80 rounded-lg text-center text-muted-foreground text-sm">
            No findings match the selected filters.
          </div>
        ) : (
          processedFindings.map((finding) => {
            const isExpanded = expandedFindingId === finding.id;

            return (
              <Card
                key={finding.id}
                className={`border border-border/80 hover:border-border transition-all duration-200 shadow-sm overflow-hidden ${
                  isExpanded ? "ring-1 ring-primary/20" : ""
                }`}
              >
                {/* Interactive Header Row */}
                <div
                  onClick={() => setExpandedFindingId(isExpanded ? null : finding.id)}
                  className="p-5 flex items-center justify-between gap-4 cursor-pointer select-none hover:bg-muted/10 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <SeverityBadge severity={finding.severity} />
                      <span className="font-mono text-xs text-muted-foreground">
                        Commit: <span className="font-semibold">{finding.commit}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">
                        Author: <span className="font-semibold text-foreground/80">{finding.author}</span>
                      </span>
                    </div>
                    <div className="text-sm font-bold text-foreground truncate">{finding.file}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{finding.change_summary}</div>
                  </div>

                  {/* Actions & Expand/Collapse Indicator */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 cursor-pointer gap-1.5 px-2.5 rounded-md border border-border/40"
                      title="Report Misclassification"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReviewFinding(finding);
                      }}
                    >
                      <MessageSquareWarning className="h-3.5 w-3.5 text-amber-500" />
                      <span className="hidden sm:inline font-medium">Review / Report</span>
                    </Button>

                    <div className="text-muted-foreground p-1">
                      {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </div>
                  </div>
                </div>

                {/* Smooth Height Expandable Panel */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden border-t border-border/60 bg-muted/10"
                    >
                      <EvidencePanel finding={finding} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })
        )}
      </div>

      {/* Review Modal */}
      {reviewFinding && (
        <ReviewModal
          finding={reviewFinding}
          repoId={repoId}
          isOpen={!!reviewFinding}
          onClose={() => setReviewFinding(null)}
        />
      )}
    </div>
  );
}
