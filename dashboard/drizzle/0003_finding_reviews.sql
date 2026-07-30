CREATE TABLE IF NOT EXISTS "finding_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"repo_id" uuid NOT NULL REFERENCES "repos"("id") ON DELETE cascade,
	"finding_id" text NOT NULL,
	"file" text NOT NULL,
	"commit" text NOT NULL,
	"rule_id" text,
	"severity" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proof" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
