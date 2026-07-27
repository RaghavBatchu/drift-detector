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
 * Environment variables required (set in .env / docker-compose):
 *   UPSTASH_REDIS_REST_URL   – https://<your-db>.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN – <your-token>
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const scanRatelimit = new Ratelimit({
  redis: Redis.fromEnv(), // reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
  limiter: Ratelimit.slidingWindow(5, "1 h"),
  prefix: "driftguard:scan",
});
