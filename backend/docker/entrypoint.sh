#!/bin/sh
# =============================================================================
#  ANWAR KPIFlow — API container entrypoint
#  1. wait for PostgreSQL
#  2. apply Prisma migrations (`db push` on first boot when no migrations exist)
#  3. optionally seed the demo organisation
#  4. start the API (the workers run in-process through BullMQ)
# =============================================================================
set -e

echo "▶ ANWAR KPIFlow API starting…"

# ------------------------------------------------------------------ wait for DB
if [ -n "$DATABASE_URL" ]; then
  echo "  · waiting for PostgreSQL…"
  i=0
  until node -e "
    const {PrismaClient}=require('@prisma/client');
    const p=new PrismaClient();
    p.\$queryRaw\`SELECT 1\`.then(()=>{p.\$disconnect();process.exit(0)}).catch(()=>process.exit(1));
  " 2>/dev/null; do
    i=$((i+1))
    if [ "$i" -ge 60 ]; then
      echo "  ✗ PostgreSQL did not become reachable in 120s" >&2
      exit 1
    fi
    sleep 2
  done
  echo "  ✓ PostgreSQL reachable"

  # ------------------------------------------------------------- migrations
  if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
      echo "  · applying Prisma migrations…"
      npx prisma migrate deploy
    else
      echo "  · no migration history found — synchronising the schema (prisma db push)…"
      npx prisma db push --skip-generate --accept-data-loss=false
    fi
    echo "  ✓ schema is up to date"
  fi

  # ------------------------------------------------------------------- seed
  USERS=$(node -e "
    const {PrismaClient}=require('@prisma/client');
    const p=new PrismaClient();
    p.user.count().then(c=>{console.log(c);return p.\$disconnect();}).catch(()=>{console.log(0);process.exit(0);});
  " 2>/dev/null || echo 0)

  if [ "${RUN_SEED:-true}" = "true" ] && [ "$USERS" = "0" ]; then
    echo "  · seeding the organisation, roles, periods and demo data…"
    node dist/prisma/seed.js 2>/dev/null || npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
    echo "  ✓ seed complete"
  else
    echo "  · seed skipped (existing data found: $USERS user(s))"
  fi
fi

echo "▶ starting the API on port ${PORT:-4000}"
exec "$@"
