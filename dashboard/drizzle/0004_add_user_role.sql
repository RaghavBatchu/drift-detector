-- Add role and admin plugin columns to user table for RBAC
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" timestamp;
