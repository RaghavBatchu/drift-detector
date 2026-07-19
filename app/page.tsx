"use client";

import { motion } from "framer-motion";
import { ShieldCheck, ShieldAlert, GitBranch, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 max-w-4xl mx-auto w-full py-12 md:py-24">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center space-y-6 max-w-2xl"
      >
        {/* Badge */}
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>System active: Monitoring 0 Repositories</span>
        </div>

        {/* Title */}
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl text-foreground font-sans">
          Configuration Drift Security Scanner
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-muted-foreground font-sans leading-relaxed">
          DriftGuard detects, analyzes, and remediates security misconfigurations and drift across your Git repositories in real-time.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <Button size="lg" className="w-full sm:w-auto font-medium gap-2 cursor-pointer">
            Get Started <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="lg" className="w-full sm:w-auto font-medium cursor-pointer">
            Read Documentation
          </Button>
        </div>
      </motion.div>

      {/* Feature Grid */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mt-16 md:mt-24"
      >
        <div className="flex flex-col items-start p-6 rounded-xl border border-border bg-card hover:bg-muted/30 transition-all">
          <div className="p-3 bg-primary/10 rounded-lg border border-primary/20 text-primary mb-4">
            <GitBranch className="h-6 w-6" />
          </div>
          <h3 className="font-semibold text-lg mb-2">Git-Level Auditing</h3>
          <p className="text-sm text-muted-foreground">
            Automatically track history, commit authors, and timeline changes to pinpoint exactly when drift was introduced.
          </p>
        </div>

        <div className="flex flex-col items-start p-6 rounded-xl border border-border bg-card hover:bg-muted/30 transition-all">
          <div className="p-3 bg-severity-high/10 rounded-lg border border-severity-high/20 text-severity-high mb-4">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h3 className="font-semibold text-lg mb-2">Severity Mapping</h3>
          <p className="text-sm text-muted-foreground">
            Rank findings by severity (Critical, High, Medium, Low) and confidence metrics to focus on real security vulnerabilities.
          </p>
        </div>

        <div className="flex flex-col items-start p-6 rounded-xl border border-border bg-card hover:bg-muted/30 transition-all">
          <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-emerald-500 mb-4">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h3 className="font-semibold text-lg mb-2">LLM Remediations</h3>
          <p className="text-sm text-muted-foreground">
            Get instant contextual AI explanations, custom security rules, and drop-in fixes to resolve drift before deployment.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
