# syntax=docker/dockerfile:1
# Override with --build-arg NODE_IMAGE=... to use a registry mirror.
ARG NODE_IMAGE=node:22-bookworm-slim

# ── Build: web app + server bundle ───────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/geo/package.json packages/geo/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── Runtime: just the bundle and its npm dependencies ────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/server/package.json ./package.json
RUN npm pkg delete devDependencies scripts \
 && npm install --omit=dev --no-audit --no-fund --no-package-lock \
 && npm cache clean --force
COPY --from=build /app/apps/server/dist ./dist
# Embedded database files live here when DATABASE_URL is not set (mount a volume).
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
