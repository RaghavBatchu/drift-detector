import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [
    "http://localhost:3000",
    "http://dashboard:3000",   // Docker inter-container
    "https://*.vercel.app",
  ],
  rateLimit: {
    enabled: true,  // explicitly enable — better-auth disables rate limiting in dev by default
    window: 60,     // time window in seconds
    max: 10,        // max requests per window per IP (tune after load testing)
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "dummy",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "dummy",
    },
  },
});
