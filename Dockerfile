# Single-container image: the API process also serves the built dashboard.
# This is the simplest way to self-host — one image, one port, no CORS, no
# separate web server. Split tiers are available via api/Dockerfile + web/Dockerfile.

# ---- Build stage ------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN npm ci

COPY api ./api
COPY web ./web

RUN npm --workspace api run generate \
 && npm --workspace api run build \
 && npm --workspace web run build \
 && npm prune --omit=dev \
 # `npm prune` can drop the generated client, so regenerate after pruning.
 && npm --workspace api run generate

# ---- Runtime stage ----------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    SERVE_WEB_DIR=/app/web/dist

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/api/node_modules ./api/node_modules
COPY --from=build --chown=node:node /app/api/dist ./api/dist
COPY --from=build --chown=node:node /app/api/prisma ./api/prisma
COPY --from=build --chown=node:node /app/api/package.json ./api/package.json
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/web/dist ./web/dist

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npx prisma migrate deploy --schema api/prisma/schema.prisma && node api/dist/src/index.js"]
