/**
 * Per-user sliding-window rate limiter for the /api/scan endpoint.
 *
 * Backed by Upstash Redis (REST API — no persistent TCP connection needed,
 * works fine in Next.js Edge and serverless environments).
 *
 * Environment variables
 * ---------------------
 *   UPSTASH_REDIS_REST_URL   – https://<your-db>.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN – <your-token>
 *     Both required for real limiting. When missing, falls back to pass-through.
 *
 *   DISABLE_RATE_LIMIT=true  – Bypass rate limiting entirely (local dev).
 *
 *   SCAN_RATE_LIMIT=5        – Max scans per rolling hour per user (default: 5).
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const disabled = process.env.DISABLE_RATE_LIMIT === "true";

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

const windowSize = parseInt(process.env.SCAN_RATE_LIMIT ?? "5", 10);

const realRatelimit =
  !disabled && hasUpstash
    ? new Ratelimit({
        redis: Redis.fromEnv(), // reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
        limiter: Ratelimit.slidingWindow(windowSize, "1 h"),
        prefix: "driftguard:scan",
      })
    : null;

export const scanRatelimit = {
  limit: async (key: string) => {
    if (!realRatelimit) {
      // Pass-through: DISABLE_RATE_LIMIT=true, or Upstash not configured
      return {
        success: true,
        limit: windowSize,
        remaining: windowSize,
        reset: Date.now() + 3600000,
      };
    }
    return realRatelimit.limit(key);
  },
};

