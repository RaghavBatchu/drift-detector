"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { RepoSummary } from "@/types/contracts";
import { Calendar, ExternalLink, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

export default function ReposPage() {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deletion state
  const [deleteTarget, setDeleteTarget] = useState<RepoSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const shouldReduceMotion = useReducedMotion();
  const router = useRouter();

  const fetchRepos = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/repos");
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/sign-in?callbackUrl=/repos");
          return;
        }
        throw new Error("Failed to fetch repositories list");
      }
      const data = await res.json();
      setRepos(data);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    fetch("/api/repos")
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            router.push("/sign-in?callbackUrl=/repos");
            return;
          }
          throw new Error("Failed to fetch repositories list");
        }
        return res.json();
      })
      .then((data) => {
        if (active && data) {
          setRepos(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "An unexpected error occurred.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [router]);

  const handleDeleteRepo = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/repos/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete repository");
      }
      // Remove deleted repo from frontend state
      setRepos((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setDeleting(false);
    }
  };

  const formatLastScan = (dateString: string | null) => {
    if (!dateString) return "Never scanned";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Helper to normalize score to 0-100 percentage
  const getScorePct = (score: number | null) => {
    if (score === null) return null;
    return score <= 1.0 ? score * 100 : score;
  };

  // Color mapping based on score
  const getScoreColor = (score: number | null) => {
    const pct = getScorePct(score);
    if (pct === null) return "text-muted-foreground bg-muted";
    if (pct >= 80) return "text-severity-critical bg-severity-critical/10 border-severity-critical/20";
    if (pct >= 50) return "text-severity-high bg-severity-high/10 border-severity-high/20";
    if (pct >= 20) return "text-severity-medium bg-severity-medium/10 border-severity-medium/20";
    return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
  };

  const getScoreProgressColor = (score: number | null) => {
    const pct = getScorePct(score);
    if (pct === null) return "bg-muted";
    if (pct >= 80) return "bg-severity-critical";
    if (pct >= 50) return "bg-severity-high";
    if (pct >= 20) return "bg-severity-medium";
    return "bg-emerald-500";
  };

  const getScoreLabel = (score: number | null) => {
    const pct = getScorePct(score);
    if (pct === null) return "Unknown";
    if (pct >= 80) return "Critical Drift";
    if (pct >= 50) return "High Drift";
    if (pct >= 20) return "Medium Drift";
    return "Low Drift";
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border border-border/60">
              <CardHeader className="space-y-2 pb-4">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-3 w-1/3" />
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-3 w-8" />
                  </div>
                  <Skeleton className="h-2 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState description={error} onRetry={fetchRepos} />;
  }

  if (repos.length === 0) {
    return (
      <div className="max-w-xl mx-auto py-12">
        <EmptyState
          title="No repositories added yet"
          description="Add and scan your first git repository to start tracking configuration drift and security changes."
          actionText="Add & Scan Repository"
          onAction={() => router.push("/")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Monitored Repositories</h1>
          <p className="text-muted-foreground mt-1">
            Overview of configuration drift and scans across your repository stack.
          </p>
        </div>
        <Link href="/">
          <Button className="font-medium gap-2 cursor-pointer shadow-sm">
            <Plus className="h-4 w-4" /> Scan New Repo
          </Button>
        </Link>
      </div>

      {/* Grid List */}
      <motion.div
        initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.3 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4"
      >
        {repos.map((repo) => (
          <Link key={repo.id} href={`/repos/${repo.id}`} className="block group">
            <Card className="h-full border border-border bg-card hover:bg-muted/20 transition-all duration-200 select-none shadow-sm cursor-pointer relative overflow-hidden">
              {/* Outer Glow Highlight on Hover */}
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-primary/40 opacity-0 group-hover:opacity-100 transition-opacity" />

              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold truncate flex items-center justify-between gap-2">
                  <span className="truncate group-hover:text-primary transition-colors">{repo.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer rounded-md"
                      title="Delete repository"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteTarget(repo);
                        setDeleteError(null);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all translate-x-[-4px] group-hover:translate-x-0" />
                  </div>
                </CardTitle>
                <CardDescription className="font-mono text-xs truncate text-muted-foreground flex items-center space-x-1">
                  <span>{repo.url}</span>
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Last Scanned */}
                <div className="flex items-center text-xs text-muted-foreground space-x-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{formatLastScan(repo.last_scan_at)}</span>
                </div>

                {/* Score Bar */}
                {repo.latest_drift_score !== null ? (() => {
                  const scorePct = getScorePct(repo.latest_drift_score)!;
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-muted-foreground">Drift Score</span>
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${getScoreColor(repo.latest_drift_score)}`}>
                          {Math.round(scorePct)} - {getScoreLabel(repo.latest_drift_score)}
                        </span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border/20">
                        <div
                          className={`h-full transition-all duration-500 ${getScoreProgressColor(repo.latest_drift_score)}`}
                          style={{ width: `${Math.min(100, Math.max(0, scorePct))}%` }}
                        />
                      </div>
                    </div>
                  );
                })() : (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-muted-foreground">Drift Score</span>
                      <span className="px-2 py-0.5 rounded-full border text-[10px] font-bold text-muted-foreground bg-muted border-border/30">
                        Pending
                      </span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border/20">
                      <div className="h-full bg-muted/60 animate-pulse w-1/12" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </motion.div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md bg-card border border-border rounded-xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-destructive/10 text-destructive shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-lg leading-none">Delete Repository</h3>
                <p className="text-sm text-muted-foreground leading-relaxed pt-1">
                  Are you sure you want to delete <span className="font-semibold text-foreground font-mono">{deleteTarget.name}</span>?
                  This will permanently delete the repository and all associated scans and findings from both the database and dashboard.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive">
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteRepo}
                disabled={deleting}
                className="cursor-pointer gap-2 font-medium"
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" /> Delete Repository
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

