# syntax=docker/dockerfile:1
#
# Production image for the public validator.
#
# Built from the workspace root (`docker build -f apps/web/Dockerfile .`) because the app depends
# on `@facturx/core` and `@facturx/db` as workspace packages, and a context scoped to apps/web
# cannot see them.

# ---- dependencies ------------------------------------------------------------
FROM node:22-alpine AS deps
RUN corepack enable pnpm
WORKDIR /repo

# Manifests only, so the dependency layer is cached independently of source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/facturx/package.json packages/facturx/
COPY packages/db/package.json packages/db/

RUN pnpm install --frozen-lockfile

# ---- build -------------------------------------------------------------------
FROM node:22-alpine AS build
RUN corepack enable pnpm
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/facturx/node_modules ./packages/facturx/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules

COPY . .

# Prisma's client is generated code; without this the build cannot resolve @prisma/client.
# A placeholder URL is enough - generation reads the schema, not the database.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    pnpm --filter @facturx/db generate

# The apps consume core's build output, so it must be built first.
RUN pnpm --filter @facturx/core build

# Baked in at build time: NEXT_PUBLIC_* values are inlined into the client bundle, so they cannot
# be supplied at run time.
ARG NEXT_PUBLIC_SITE_URL=https://validateur-facturx.fr
ARG NEXT_PUBLIC_ALLOW_INDEXING=false
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ALLOW_INDEXING=$NEXT_PUBLIC_ALLOW_INDEXING \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @facturx/web build

# ---- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

# Reports unhealthy when the validation engine is unreachable, since a validator that cannot
# validate should be pulled from the load balancer rather than serve failures.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/valider >/dev/null || exit 1

CMD ["node", "apps/web/server.js"]
