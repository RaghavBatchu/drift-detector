/**
 * Per-user sliding-window rate limiter for the /api/scan endpoint.
 *
 * Backed by Upstash Redis (REST API — no persistent TCP connection needed,
 * works fine in Next.js Edge and serverless environments).
 *
 * Limit: 5 requests per user per rolling hour.
 *
 * Usage
 * -----
 * import { scanRatelimit } from "@/lib/rate-limit";
 *
 * const { success, limit, remaining, reset } = await scanRatelimit.limit(userId);
 * if (!success) { return 429; }
 *
 * Environment variables required (optional in local dev / standalone docker):
 *   UPSTASH_REDIS_REST_URL   – https://<your-db>.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN – <your-token>
 *
 * If environment variables are missing, falls back to a permissive pass-through
 * so local development and docker-compose without Upstash credentials work cleanly.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

const realRatelimit = hasUpstash
  ? new Ratelimit({
      redis: Redis.fromEnv(), // reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      prefix: "driftguard:scan",
    })
  : null;

export const scanRatelimit = {
  limit: async (key: string) => {
    if (!realRatelimit) {
      // Pass-through when Upstash Redis is unconfigured
      return {
        success: true,
        limit: 5,
        remaining: 5,
        reset: Date.now() + 3600000,
      };
    }
    return realRatelimit.limit(key);
  },
};
