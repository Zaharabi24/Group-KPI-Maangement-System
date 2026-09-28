# =============================================================================
#  ANWAR KPIFlow — backend image (NestJS + Prisma)
#  Multi-stage: deps → build → runtime (non-root, health-checked)
# =============================================================================

# ------------------------------------------------------------------ base / deps
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# ---------------------------------------------------------------------- build
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY package.json nest-cli.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build
# The seed runs at container start, so it is compiled alongside the API.
RUN npx tsc prisma/seed.ts prisma/seed-data.ts prisma/snapshot-helper.ts \
      --outDir dist/prisma --module commonjs --target ES2023 --moduleResolution node \
      --esModuleInterop --skipLibCheck --resolveJsonModule --strict false

# -------------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat curl tini \
 && addgroup -g 1001 -S nodejs \
 && adduser -S -u 1001 -G nodejs anwar

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/storage/evidence /app/storage/exports \
 && chown -R anwar:nodejs /app/storage /app

USER anwar
EXPOSE 4000

HEALTHCHECK --interval=20s --timeout=6s --start-period=60s --retries=10 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
