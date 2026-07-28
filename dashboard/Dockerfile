# ============================================================
# Dashboard — Multi-stage Dockerfile
# ============================================================
# Stage 1 (deps):    install all pnpm dependencies
# Stage 2 (builder): build the Next.js production bundle
# Stage 3 (runner):  lean runtime image using standalone output
# ============================================================

# ---- Stage 1: Install dependencies -------------------------
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy lockfile and manifest first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

# ---- Stage 2: Build the Next.js app ------------------------
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Bring in installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy all source files
COPY . .

# Build-time env vars that Next.js bakes in at compile time.
# These are the *public* vars (NEXT_PUBLIC_*) or vars needed by next build.
# Runtime secrets (DATABASE_URL, auth keys) are NOT needed here.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000

RUN pnpm build

# Copy drizzle-kit CLI into builder so it's available for the migration step
# (drizzle-kit is a devDependency; it's in node_modules from the deps stage)

# ---- Stage 3: Production runner ----------------------------
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy the standalone output (includes the server and required files)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# ---- DB migrations -------------------------------------------------
# drizzle-kit migrate reads drizzle.config.ts + the SQL files in ./drizzle.
# We copy only what it needs so the runner image stays lean.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/db ./db
# drizzle-kit itself (CLI + ORM) needs to be resolvable at runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# --------------------------------------------------------------------

EXPOSE 3000

# Run migrations then start the Next.js standalone server.
# Using sh -c so that a migration failure stops the container (exit 1)
# rather than silently starting a broken server.
CMD ["sh", "-c", "npx drizzle-kit migrate && node server.js"]
