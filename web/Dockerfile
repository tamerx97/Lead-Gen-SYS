# Builds the dashboard and serves it from nginx.
# Only needed if you run the web tier separately; the single-container setup in
# ../Dockerfile serves the same assets from the API process instead.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN npm ci --workspace web --include-workspace-root

COPY web ./web
RUN npm --workspace web run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
