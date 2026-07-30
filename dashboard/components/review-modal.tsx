"use client";

import React, { useState } from "react";
import { Finding } from "@/types/contracts";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2, MessageSquareWarning, X } from "lucide-react";

interface ReviewModalProps {
  finding: Finding;
  repoId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ReviewModal({ finding, repoId, isOpen, onClose, onSuccess }: ReviewModalProps) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please describe why you think this finding is misclassified.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId,
          findingId: finding.id,
          file: finding.file,
          commit: finding.commit,
          ruleId: finding.evidence?.rules?.[0] || null,
          severity: finding.severity,
          reason: reason.trim(),
          // Complete proof snapshot transported as proof context
          proof: {
            ...finding,
            reportedAt: new Date().toISOString(),
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit review report.");
      }

      setSubmitted(true);
      if (onSuccess) onSuccess();
      setTimeout(() => {
        setSubmitted(false);
        setReason("");
        onClose();
      }, 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => !loading && onClose()}
    >
      <div
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-border/80 flex items-start justify-between gap-4 bg-muted/20">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-full bg-amber-500/10 text-amber-500 shrink-0 mt-0.5">
              <MessageSquareWarning className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">Report Misclassification</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Help improve DriftGuard detection by reporting false positives or wrong rule severity.
              </p>
            </div>
          </div>
          <button
            onClick={() => !loading && onClose()}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content / Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Proof Summary Callout */}
          <div className="p-3.5 rounded-lg bg-muted/40 border border-border/60 text-xs space-y-1.5 font-mono">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-bold text-foreground truncate">{finding.file}</span>
              <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border font-sans font-bold">
                {finding.severity}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              Commit: <span className="text-foreground">{finding.commit}</span> • Author:{" "}
              <span className="text-foreground">{finding.author}</span>
            </div>
            {finding.evidence?.rules && finding.evidence.rules.length > 0 && (
              <div className="text-[11px] text-amber-500 font-sans font-medium">
                Rule Matched: {finding.evidence.rules.join(", ")}
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {submitted && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-xs text-emerald-500 flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Report & proof snapshot submitted! Thank you for your feedback.</span>
            </div>
          )}

          {/* Feedback Textarea */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Why is this classification incorrect?
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading || submitted}
              rows={4}
              placeholder="Describe why this finding is a false positive, test file exemption, intended architecture, or misclassified rule..."
              className="w-full rounded-lg border border-border bg-muted/20 p-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/40">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading || submitted}
              className="cursor-pointer text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || submitted || !reason.trim()}
              className="cursor-pointer text-xs font-medium gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting Report…
                </>
              ) : (
                "Submit Review"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
