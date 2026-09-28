# =============================================================================
#  ANWAR KPIFlow — deployment guide
# =============================================================================
#  Three supported topologies:
#    1. Docker Compose on a VPS (the complete stack, recommended for production)
#    2. Vercel (front end) + a managed API host (Railway / Render / Fly / VPS)
#    3. Local development
# =============================================================================

## 1. Docker Compose on a VPS — the complete stack

```bash
git clone https://github.com/Zaharabi24/Group-KPI-Maangement-System.git
cd Group-KPI-Maangement-System
cp .env.example .env            # then edit the secrets below
docker compose up -d --build
```

| Service | URL | Notes |
|---|---|---|
| Web (React + Nginx) | http://localhost:8090 | the application |
| API (NestJS) | http://localhost:4100/api/v1 | reverse-proxied at `/api` by Nginx |
| Mailpit inbox | http://localhost:8026 | captures every e-mail (NT-01 … NT-19) |
| PostgreSQL | localhost:5433 | user `anwar_kpi`, database `anwar_kpi` |
| Redis | localhost:6380 | queue + cache |

On first boot the API container waits for PostgreSQL, applies the Prisma schema
(`prisma migrate deploy`, or `db push` when no migration history exists) and runs
the seed when the database is empty. Set `RUN_SEED=false` to skip it.

**Production secrets to change (`.env` next to `docker-compose.yml`):**

```dotenv
POSTGRES_PASSWORD=<strong-password>
JWT_ACCESS_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
EVIDENCE_ENCRYPTION_KEY=<openssl rand -hex 32>
COOKIE_SECURE=true
APP_URL=https://kpi.anwargroup.net
CORS_ORIGINS=https://kpi.anwargroup.net
SEED_SUPER_ADMIN_PASSWORD=<strong-password>
MAIL_TRANSPORT=smtp
SMTP_HOST=<corporate relay>
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=<relay user>
SMTP_PASSWORD=<relay password>
```

**Put Nginx/Traefik in front for TLS** and forward `/api` to the `api` service.
The refresh-token cookie is `HttpOnly`, `SameSite=Strict`, so the SPA and the API
must share one origin in production.

---

## 2. Vercel (front end) + managed API

Vercel hosts the React build; the NestJS API, PostgreSQL and Redis run elsewhere.

### 2.1 Deploy the API first

Any Node host works. Example with Railway:

1. New project → **Deploy from GitHub repo** → set **Root Directory** to `backend`.
2. Add the **PostgreSQL** and **Redis** plugins; Railway injects `DATABASE_URL` and `REDIS_URL`.
3. Environment variables:

```dotenv
NODE_ENV=production
PORT=4000
API_PREFIX=api/v1
APP_URL=https://<your-vercel-app>.vercel.app
CORS_ORIGINS=https://<your-vercel-app>.vercel.app
JWT_ACCESS_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
EVIDENCE_ENCRYPTION_KEY=<openssl rand -hex 32>
COOKIE_SECURE=true
COOKIE_SAMESITE=none
ALLOWED_EMAIL_DOMAIN=anwargroup.net
STORAGE_LOCAL_PATH=/data/storage/evidence
EXPORT_LOCAL_PATH=/data/storage/exports
MAIL_TRANSPORT=smtp
SMTP_HOST=<relay>  SMTP_PORT=587  SMTP_SECURE=true
SMTP_USER=<user>   SMTP_PASSWORD=<password>
MALWARE_SCAN_ENABLED=false
RUN_MIGRATIONS=true
RUN_SEED=true
```

4. Mount a persistent volume at `/data` so evidence and exports survive restarts.
5. Note the public API origin, e.g. `https://anwar-kpi-api.up.railway.app`.

> `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none` are required when the SPA and the
> API are on different origins (Vercel + Railway). Always with HTTPS.

### 2.2 Deploy the front end to Vercel

1. **Add New Project** → import the repository.
2. **Root Directory**: leave the repository root (the root `vercel.json` builds `frontend/`).
3. **Framework preset**: Vite. Build command and output directory come from `vercel.json`.
4. **Environment variable** (Production + Preview + Development):
   ```dotenv
   VITE_API_BASE_URL=/api/v1
   ```
5. **Edit `vercel.json`** and replace the rewrite placeholder with your API origin:
   ```json
   { "source": "/api/:path*", "destination": "https://<your-api-host>/api/:path*" }
   ```
   Keeping the API behind the same origin as the SPA means the `SameSite=Strict`
   refresh cookie keeps working with no extra configuration.
6. Deploy.

### 2.3 Alternative: direct cross-origin API calls

If you prefer not to use the rewrite, set `VITE_API_BASE_URL` to the full API URL
(`https://<your-api-host>/api/v1`) **and** keep `COOKIE_SECURE=true` +
`COOKIE_SAMESITE=none` plus `CORS_ORIGINS` on the API.

### 2.4 Vercel checklist

- [ ] `vercel.json` rewrite points at the real API host
- [ ] `VITE_API_BASE_URL` set for all environments
- [ ] API `CORS_ORIGINS` includes the exact Vercel domain (no trailing slash)
- [ ] API `APP_URL` is the Vercel domain so e-mail deep links resolve
- [ ] `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none` on the API
- [ ] Database migrated and seeded (`RUN_SEED=true` on the first boot only)
- [ ] A persistent volume is mounted for `STORAGE_LOCAL_PATH`
- [ ] The SMTP relay is configured and verified from `/admin/system-health`

---

## 3. Local development

```bash
# 1. Infrastructure
docker compose up -d postgres redis mailpit

# 2. Backend  (http://localhost:4100/api/v1)
cd backend
cp .env.example .env            # DATABASE_URL points at localhost:5433
npm install
npx prisma generate
npx prisma migrate dev
npm run seed
npm run start:dev

# 3. Frontend (http://localhost:5273)
cd ../frontend
npm install
npm run dev
```

Verification scripts:

```bash
cd backend
node scripts/smoke-test.mjs        # 85 workflow assertions
node scripts/evidence-check.mjs    # 15 evidence / signed-URL assertions
node scripts/capture-screenshots.mjs
```

---

## 4. Database operations

```bash
npx prisma migrate dev --name <change>   # create a migration during development
npx prisma migrate deploy                # apply migrations in production
npx prisma migrate reset --force         # wipe and re-create (development only)
npx prisma studio                        # browse the data
npm run seed                             # idempotent seed
```

Backups (NFR-BAK-01): enable WAL archiving on the PostgreSQL volume, take nightly
full backups kept 35 days and monthly backups kept 12 months, store an encrypted
off-site copy and run a restore test every quarter.
