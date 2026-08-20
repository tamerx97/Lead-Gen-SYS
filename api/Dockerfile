# API-only image, for deployments that run the dashboard on a separate web tier.
# For a single container that serves both, use the Dockerfile at the repo root.

# ---- Build stage ------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Dependencies first, so this layer caches across code changes.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN npm ci --workspace api --include-workspace-root

COPY api ./api
RUN npm --workspace api run generate \
 && npm --workspace api run build \
 && npm prune --omit=dev --workspace api --include-workspace-root \
 # `npm prune` can drop the generated client, so regenerate after pruning.
 && npm --workspace api run generate

# ---- Runtime stage ----------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/api/node_modules ./api/node_modules
COPY --from=build --chown=node:node /app/api/dist ./api/dist
COPY --from=build --chown=node:node /app/api/prisma ./api/prisma
COPY --from=build --chown=node:node /app/api/package.json ./api/package.json
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `migrate deploy` is idempotent and takes an advisory lock, so it is safe on
# every boot and across replicas.
CMD ["sh", "-c", "npx prisma migrate deploy --schema api/prisma/schema.prisma && node api/dist/src/index.js"]
