# Builds the frontend, then runs the relay serving it. One container, one
# port (8000): static files + /room/<ID> WebSockets + /health.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY web/package.json web/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8000 \
    STATIC_DIR=/app/web/dist
COPY relay ./relay
COPY --from=build /app/web/dist ./web/dist
EXPOSE 8000
# The image ships an unprivileged `bun` user; files above stay root-owned
# and read-only to it.
USER bun
CMD ["bun", "run", "relay/server.js"]
