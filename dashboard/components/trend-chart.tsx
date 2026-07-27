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
   * Defaults to false (single accumulated-score line).
   */
  showDualSeries?: boolean;
}

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

    const formatted = trend.map((pt, idx) => {
      const date = new Date(pt.date);
      const formattedDate = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      // Simulate the per-scan raw score for the dual-series view.
      // In the real pipeline the trend_points table stores accumulated scores.
      // We reconstruct a plausible raw score by reversing the accumulation
      // approximation: raw ≈ accumulated * (1 - 0.85) / (1 - 0.85^(idx+1)).
      // For the first scan raw = accumulated (no history to weight against).
      const accumulated = parseFloat((pt.score * 100).toFixed(1));
      const decayFactor = 0.85;
      const age = idx + 1;
      const weight = (1 - decayFactor) / (1 - Math.pow(decayFactor, age));
      const rawEstimate = parseFloat(Math.min(accumulated / weight, 100).toFixed(1));

      return {
        formattedDate,
        score: accumulated,          // accumulated (primary)
        rawScore: rawEstimate,       // per-scan estimate (secondary, dashed)
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

  const tooltipStyle = {
    backgroundColor: "var(--card)",
    borderColor: "var(--border)",
    borderRadius: "8px",
    color: "var(--foreground)",
    fontSize: "12px",
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
  };

  if (showDualSeries && chartData.length > 1) {
    return (
      <div className="w-full h-[360px] select-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 35, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="accGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.35} />
            <XAxis dataKey="formattedDate" {...commonAxisProps} dy={8} />
            <YAxis {...commonAxisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} dx={-8} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number, name: string) => [
                `${value.toFixed(1)}%`,
                name === "score" ? "Accumulated Score" : "Per-scan Score",
              ]}
              labelFormatter={(label) => `Scan Date: ${label}`}
            />
            <Legend
              formatter={(value) =>
                value === "score" ? "Accumulated Score" : "Per-scan Estimate"
              }
              wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
            />

            {/* Primary: accumulated score — solid */}
            <Line
              type="monotone"
              dataKey="score"
              stroke="hsl(var(--primary))"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2 }}
              isAnimationActive={!shouldReduceMotion}
            />

            {/* Secondary: per-scan estimate — dashed */}
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
                x={peakPoint.formattedDate}
                y={peakPoint.score}
                r={5}
                fill="var(--severity-critical)"
                stroke="var(--background)"
                strokeWidth={2}
                label={{
                  value: `Peak: ${peakPoint.score.toFixed(0)}%`,
                  position: "top",
                  fill: "hsl(var(--foreground))",
                  fontSize: 10,
                  fontWeight: "600",
                }}
              />
            )}

            {/* Latest point marker */}
            {latestPoint && latestPoint.formattedDate !== peakPoint?.formattedDate && (
              <ReferenceDot
                x={latestPoint.formattedDate}
                y={latestPoint.score}
                r={5}
                fill="hsl(var(--primary))"
                stroke="var(--background)"
                strokeWidth={2}
                label={{
                  value: `Now: ${latestPoint.score.toFixed(0)}%`,
                  position: "top",
                  fill: "hsl(var(--foreground))",
                  fontSize: 10,
                  fontWeight: "600",
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Single-series (default) — area chart for the accumulated score
  return (
    <div className="w-full h-[360px] select-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 20, right: 35, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.35} />
          <XAxis
            dataKey="formattedDate"
            {...commonAxisProps}
            dy={8}
          />
          <YAxis
            {...commonAxisProps}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            dx={-8}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number) => [`${value}%`, "Accumulated Drift Score"]}
            labelFormatter={(label) => `Scan Date: ${label}`}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="hsl(var(--primary))"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#trendGradient)"
            isAnimationActive={!shouldReduceMotion}
          />

          {/* Peak point reference marker */}
          {peakPoint && (
            <ReferenceDot
              x={peakPoint.formattedDate}
              y={peakPoint.score}
              r={5}
              fill="var(--severity-critical)"
              stroke="var(--background)"
              strokeWidth={2}
              label={{
                value: `Peak: ${peakPoint.score.toFixed(0)}%`,
                position: "top",
                fill: "hsl(var(--foreground))",
                fontSize: 10,
                fontWeight: "600",
              }}
            />
          )}

          {/* Latest point reference marker */}
          {latestPoint && latestPoint.formattedDate !== peakPoint?.formattedDate && (
            <ReferenceDot
              x={latestPoint.formattedDate}
              y={latestPoint.score}
              r={5}
              fill="hsl(var(--primary))"
              stroke="var(--background)"
              strokeWidth={2}
              label={{
                value: `Current: ${latestPoint.score.toFixed(0)}%`,
                position: "top",
                fill: "hsl(var(--foreground))",
                fontSize: 10,
                fontWeight: "600",
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
