"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";

interface TrendPoint {
  date: string;
  score: number;
}

interface TrendChartProps {
  trend: TrendPoint[];
  /**
   * When true, renders a dual-series chart showing both the accumulated
   * score (the primary line) and the raw per-scan score (dashed secondary).
   * Defaults to false (single accumulated-score area chart).
   */
  showDualSeries?: boolean;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;
  const score = data.score;
  const rawScore = data.rawScore;
  const delta = data.delta;

  let severity = "Low";
  let severityColor = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
  if (score >= 80) {
    severity = "Critical";
    severityColor = "text-severity-critical bg-severity-critical/10 border-severity-critical/20";
  } else if (score >= 50) {
    severity = "High";
    severityColor = "text-severity-high bg-severity-high/10 border-severity-high/20";
  } else if (score >= 20) {
    severity = "Medium";
    severityColor = "text-severity-medium bg-severity-medium/10 border-severity-medium/20";
  }

  return (
    <div className="bg-card/95 backdrop-blur-md border border-border p-3.5 rounded-xl shadow-xl min-w-[220px] text-xs space-y-2 select-none">
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <span className="font-bold text-foreground">Scan #{data.scanIndex}</span>
        <span className="text-[11px] text-muted-foreground">{data.fullDateTime}</span>
      </div>

      <div className="space-y-1.5 pt-0.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground font-medium">Accumulated Score:</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm text-foreground">{score.toFixed(1)}%</span>
            <span className={`px-1.5 py-0.2 rounded-full border text-[9px] font-bold ${severityColor}`}>
              {severity}
            </span>
          </div>
        </div>

        {rawScore !== undefined && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground font-medium">Per-Scan Impact:</span>
            <span className="font-mono text-muted-foreground font-semibold">{rawScore.toFixed(1)}%</span>
          </div>
        )}

        {delta !== null && delta !== undefined && (
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40">
            <span className="text-muted-foreground text-[11px]">Change from Prior Scan:</span>
            <span
              className={`font-mono text-[11px] font-semibold ${
                delta > 0 ? "text-severity-high" : delta < 0 ? "text-emerald-500" : "text-muted-foreground"
              }`}
            >
              {delta > 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export function TrendChart({ trend, showDualSeries = false }: TrendChartProps) {
  const [mounted, setMounted] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  const { chartData, peakPoint, latestPoint } = useMemo(() => {
    if (!trend || trend.length === 0) {
      return { chartData: [], peakPoint: null, latestPoint: null };
    }

    // Check for multiple scans on the same date string so we can append time
    const dateCounts = new Map<string, number>();
    trend.forEach((pt) => {
      const d = new Date(pt.date);
      const dayStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dateCounts.set(dayStr, (dateCounts.get(dayStr) || 0) + 1);
    });

    let prevScore: number | null = null;

    const formatted = trend.map((pt, idx) => {
      const date = new Date(pt.date);
      const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      const fullDateTime = date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const isMultiScanDay = (dateCounts.get(dateStr) || 0) > 1;
      const xLabel = isMultiScanDay ? `${dateStr} ${timeStr}` : dateStr;

      // Handle float (0.0-1.0) vs percentage scale safely
      const rawVal = pt.score;
      const accumulated = parseFloat((rawVal <= 1.0 ? rawVal * 100 : rawVal).toFixed(1));

      // Estimate per-scan raw score for dual series
      const decayFactor = 0.85;
      const age = idx + 1;
      const weight = (1 - decayFactor) / (1 - Math.pow(decayFactor, age));
      const rawEstimate = parseFloat(Math.min(accumulated / weight, 100).toFixed(1));

      const delta = prevScore !== null ? parseFloat((accumulated - prevScore).toFixed(1)) : null;
      prevScore = accumulated;

      return {
        id: `scan-${idx + 1}`,
        scanIndex: idx + 1,
        xLabel,
        fullDateTime,
        score: accumulated,
        rawScore: rawEstimate,
        delta,
        rawDate: date,
      };
    });

    // Find peak and latest points
    let peak = formatted[0];
    formatted.forEach((pt) => {
      if (pt.score > peak.score) {
        peak = pt;
      }
    });

    const latest = formatted[formatted.length - 1];

    return {
      chartData: formatted,
      peakPoint: peak,
      latestPoint: latest,
    };
  }, [trend]);

  if (!mounted) {
    return (
      <div className="h-[360px] flex items-center justify-center border border-dashed border-border/80 rounded-lg bg-card/50">
        <span className="text-xs text-muted-foreground animate-pulse">Initializing analytics...</span>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="h-[360px] flex items-center justify-center border border-dashed border-border/80 rounded-lg bg-card/50 text-xs text-muted-foreground">
        No trend data available.
      </div>
    );
  }

  const commonAxisProps = {
    stroke: "var(--muted-foreground)" as string,
    fontSize: 11,
    tickLine: false,
    axisLine: false,
  };

  if (showDualSeries && chartData.length > 1) {
    return (
      <div className="w-full h-[360px] select-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 25, right: 35, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.35} />
            <XAxis dataKey="xLabel" {...commonAxisProps} dy={8} />
            <YAxis {...commonAxisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} dx={-8} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value) => (value === "score" ? "Accumulated Score (History)" : "Per-scan Impact (Estimate)")}
              wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
            />

            {/* Primary: accumulated score — solid smooth curve */}
            <Line
              type="monotone"
              dataKey="score"
              stroke="hsl(var(--primary))"
              strokeWidth={3}
              dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 2, stroke: "var(--card)" }}
              activeDot={{ r: 6, strokeWidth: 2, fill: "hsl(var(--primary))" }}
              isAnimationActive={!shouldReduceMotion}
            />

            {/* Secondary: per-scan estimate — dashed curve */}
            <Line
              type="monotone"
              dataKey="rawScore"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 1 }}
              isAnimationActive={!shouldReduceMotion}
            />

            {/* Peak accumulated score marker */}
            {peakPoint && (
              <ReferenceDot
                x={peakPoint.xLabel}
                y={peakPoint.score}
                r={6}
                fill="var(--severity-critical)"
                stroke="var(--background)"
                strokeWidth={2}
                label={{
                  value: `Peak: ${peakPoint.score.toFixed(0)}%`,
                  position: "top",
                  fill: "hsl(var(--foreground))",
                  fontSize: 10,
                  fontWeight: "700",
                }}
              />
            )}

            {/* Latest point marker */}
            {latestPoint && latestPoint.xLabel !== peakPoint?.xLabel && (
              <ReferenceDot
                x={latestPoint.xLabel}
                y={latestPoint.score}
                r={6}
                fill="hsl(var(--primary))"
                stroke="var(--background)"
                strokeWidth={2}
                label={{
                  value: `Current: ${latestPoint.score.toFixed(0)}%`,
                  position: "top",
                  fill: "hsl(var(--foreground))",
                  fontSize: 10,
                  fontWeight: "700",
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Single-series — Area chart with rich smooth gradient fill
  return (
    <div className="w-full h-[360px] select-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 25, right: 35, left: -10, bottom: 5 }}>
          <defs>
            <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.35} />
          <XAxis dataKey="xLabel" {...commonAxisProps} dy={8} />
          <YAxis {...commonAxisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} dx={-8} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="score"
            stroke="hsl(var(--primary))"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#trendGradient)"
            dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 2, stroke: "var(--card)" }}
            activeDot={{ r: 6, strokeWidth: 2, fill: "hsl(var(--primary))" }}
            isAnimationActive={!shouldReduceMotion}
          />

          {/* Peak point reference marker */}
          {peakPoint && (
            <ReferenceDot
              x={peakPoint.xLabel}
              y={peakPoint.score}
              r={6}
              fill="var(--severity-critical)"
              stroke="var(--background)"
              strokeWidth={2}
              label={{
                value: `Peak: ${peakPoint.score.toFixed(0)}%`,
                position: "top",
                fill: "hsl(var(--foreground))",
                fontSize: 10,
                fontWeight: "700",
              }}
            />
          )}

          {/* Latest point reference marker */}
          {latestPoint && latestPoint.xLabel !== peakPoint?.xLabel && (
            <ReferenceDot
              x={latestPoint.xLabel}
              y={latestPoint.score}
              r={6}
              fill="hsl(var(--primary))"
              stroke="var(--background)"
              strokeWidth={2}
              label={{
                value: `Current: ${latestPoint.score.toFixed(0)}%`,
                position: "top",
                fill: "hsl(var(--foreground))",
                fontSize: 10,
                fontWeight: "700",
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
