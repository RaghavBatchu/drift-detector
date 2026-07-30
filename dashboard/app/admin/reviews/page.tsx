"use client";

import React, { useEffect, useState } from "react";
import { Finding } from "@/types/contracts";
import { SeverityBadge } from "@/components/severity-badge";
import { EvidencePanel } from "@/components/evidence-panel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  MessageSquareWarning,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface FindingReviewItem {
  id: string;
  repoId: string;
  repoName: string;
  userId: string;
  userEmail: string;
  findingId: string;
  file: string;
  commit: string;
  ruleId: string | null;
  severity: string;
  reason: string;
  status: "pending" | "resolved" | "dismissed";
  proof: Finding & { reportedAt?: string };
  createdAt: string;
}

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<FindingReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const shouldReduceMotion = useReducedMotion();
  const router = useRouter();

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);
    setIsForbidden(false);
    try {
      const res = await fetch("/api/reviews");
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/sign-in?callbackUrl=/admin/reviews");
          return;
        }
        if (res.status === 403) {
          setIsForbidden(true);
          return;
        }
        throw new Error("Failed to fetch classification reviews list");
      }
      const data = await res.json();
      setReviews(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const handleUpdateStatus = async (reviewId: string, newStatus: "resolved" | "dismissed" | "pending") => {
    setActionLoadingId(reviewId);
    try {
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        throw new Error("Failed to update status");
      }

      setReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, status: newStatus } : r))
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update review status");
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredReviews = reviews.filter((r) => {
    const matchesStatus = statusFilter === "all" || r.status === statusFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      r.repoName.toLowerCase().includes(q) ||
      r.file.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q) ||
      r.userEmail.toLowerCase().includes(q) ||
      r.commit.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const pendingCount = reviews.filter((r) => r.status === "pending").length;
  const resolvedCount = reviews.filter((r) => r.status === "resolved").length;
  const dismissedCount = reviews.filter((r) => r.status === "dismissed").length;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto py-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="space-y-4 pt-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (isForbidden) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center space-y-4">
        <Card className="border border-destructive/30 bg-destructive/5 p-8 space-y-4 shadow-xl">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-foreground">403 Access Denied</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You do not have administrator privileges to access or manage misclassification review reports.
            </p>
          </div>
          <div className="pt-2">
            <Link href="/repos">
              <Button className="cursor-pointer font-medium">Return to Monitored Repositories</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <MessageSquareWarning className="h-8 w-8 text-amber-500" />
            Misclassification Reviews
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review user-reported false positives, wrong rules, and classification feedback with proof snapshots.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchReviews}
          className="cursor-pointer gap-2 shrink-0 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh List
        </Button>
      </div>

      {/* Stats Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border border-amber-500/20 bg-amber-500/5 p-4 flex items-center gap-4">
          <div className="p-3 rounded-full bg-amber-500/10 text-amber-500">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold">{pendingCount}</div>
            <div className="text-xs text-amber-500 font-semibold uppercase tracking-wider">
              Pending Reviews
            </div>
          </div>
        </Card>

        <Card className="border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center gap-4">
          <div className="p-3 rounded-full bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold">{resolvedCount}</div>
            <div className="text-xs text-emerald-500 font-semibold uppercase tracking-wider">
              Resolved Reports
            </div>
          </div>
        </Card>

        <Card className="border border-border bg-card p-4 flex items-center gap-4">
          <div className="p-3 rounded-full bg-muted text-muted-foreground">
            <XCircle className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold">{dismissedCount}</div>
            <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
              Dismissed Reports
            </div>
          </div>
        </Card>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by repo, file, user, or reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-muted/20 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border border-border/60 self-start sm:self-auto">
          {[
            { value: "all", label: `All (${reviews.length})` },
            { value: "pending", label: `Pending (${pendingCount})` },
            { value: "resolved", label: `Resolved (${resolvedCount})` },
            { value: "dismissed", label: `Dismissed (${dismissedCount})` },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                statusFilter === tab.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reviews List */}
      {error ? (
        <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl text-center space-y-2">
          <AlertCircle className="h-6 w-6 text-destructive mx-auto" />
          <p className="text-xs text-destructive font-medium">{error}</p>
        </div>
      ) : filteredReviews.length === 0 ? (
        <Card className="border border-dashed border-border/80 p-12 text-center text-muted-foreground">
          <MessageSquareWarning className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
          <h3 className="font-bold text-sm text-foreground">No misclassification reviews found</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {searchQuery || statusFilter !== "all"
              ? "Try adjusting your search or status filter."
              : "When users report incorrect findings, they will appear here along with full proof diffs."}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredReviews.map((review) => {
            const isExpanded = expandedReviewId === review.id;
            const isActioning = actionLoadingId === review.id;

            return (
              <Card
                key={review.id}
                className="border border-border/80 hover:border-border transition-all duration-200 shadow-sm overflow-hidden"
              >
                {/* Header */}
                <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card">
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {/* Status Badge */}
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                          review.status === "pending"
                            ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                            : review.status === "resolved"
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            : "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {review.status}
                      </span>

                      <SeverityBadge severity={review.severity as any} />

                      <span className="font-bold text-primary">{review.repoName}</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {review.userEmail}
                      </span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-muted-foreground text-[11px]">
                        {formatDate(review.createdAt)}
                      </span>
                    </div>

                    <div className="font-mono text-sm font-bold text-foreground truncate">
                      {review.file}
                    </div>

                    {/* User Feedback Reason */}
                    <div className="p-3 bg-muted/30 border border-border/60 rounded-lg text-xs leading-relaxed text-foreground/90">
                      <span className="font-semibold text-muted-foreground block text-[10px] uppercase tracking-wider mb-1">
                        User Feedback / Reason:
                      </span>
                      &quot;{review.reason}&quot;
                    </div>
                  </div>

                  {/* Actions & Expand Proof Button */}
                  <div className="flex items-center gap-2 shrink-0 self-start md:self-center pt-2 md:pt-0 border-t md:border-t-0 border-border/40 w-full md:w-auto justify-between md:justify-end">
                    <div className="flex items-center gap-1.5 min-w-[170px]">
                      {review.status === "pending" ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isActioning}
                            onClick={() => handleUpdateStatus(review.id, "resolved")}
                            className="h-8 text-xs text-emerald-500 hover:bg-emerald-500/10 border-emerald-500/20 cursor-pointer"
                          >
                            Mark Resolved
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isActioning}
                            onClick={() => handleUpdateStatus(review.id, "dismissed")}
                            className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            Dismiss
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isActioning}
                          onClick={() => handleUpdateStatus(review.id, "pending")}
                          className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer border-border/40"
                          title="Re-open report"
                        >
                          Re-open Report
                        </Button>
                      )}
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setExpandedReviewId(isExpanded ? null : review.id)}
                      className="h-8 text-xs cursor-pointer gap-1.5 shrink-0"
                    >
                      <span>{isExpanded ? "Hide Proof" : "Inspect Proof"}</span>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Proof Snapshot Accordion */}
                <AnimatePresence initial={false}>
                  {isExpanded && review.proof && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden border-t border-border bg-muted/10"
                    >
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground font-bold uppercase tracking-wider px-2">
                          <span>Proof Snapshot (Finding Card Context at Report Time)</span>
                          <span className="font-mono text-[11px]">Commit: {review.commit}</span>
                        </div>

                        <div className="border border-border/60 rounded-xl bg-card overflow-hidden">
                          <EvidencePanel finding={review.proof} />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
