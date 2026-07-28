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
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000

RUN pnpm build

# ---- Stage 3: Production runner ----------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules from deps to ensure all dependencies and pnpm symlinks are intact
COPY --from=deps /app/node_modules ./node_modules

# Copy the standalone output (includes server.js and required files)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/migrate.mjs ./migrate.mjs

EXPOSE 3000

# Run migrations (idempotent) then start the Next.js standalone server.
# A migration failure exits non-zero and stops the container immediately.
CMD ["sh", "-c", "node migrate.mjs && node server.js"]
