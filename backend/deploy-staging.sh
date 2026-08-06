#!/usr/bin/env bash
#
# deploy-staging.sh — deploy & (re)start the ATS backend + worker as STAGING.
#
# Run this from the staging backend directory after uploading new code:
#   cd /var/www/html/ats-platform-staging/backend
#   ./deploy-staging.sh
#
# It is idempotent: on first run it starts the PM2 apps; on later runs it
# reloads them with zero downtime. Steps that need manual secrets (the
# .env.staging file) are guarded so it won't silently start with bad config.

set -euo pipefail

# Always operate from the directory this script lives in.
cd "$(dirname "$0")"

ENV_NAME="staging"
ENV_FILE=".env.staging"
BACKEND_APP="ats-staging-backend"
WORKER_APP="ats-staging-worker"
ECOSYSTEM="ecosystem.config.cjs"

echo "==> Deploying ATS backend as ${ENV_NAME}"
echo "    Working directory: $(pwd)"

# 1. Ensure the staging env file exists. Never auto-fill secrets.
if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  echo "       Create it first:  cp ${ENV_FILE}.example ${ENV_FILE}  && edit the secrets."
  exit 1
fi
echo "==> Found ${ENV_FILE}"

# 2. Install dependencies (include devDeps; cross-env/prisma CLI live there).
echo "==> Installing dependencies (npm ci)"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# 3. Generate the Prisma client.
echo "==> Generating Prisma client"
npm run prisma:generate

# 4. Sanity-check Redis (the resume worker needs it).
echo "==> Checking Redis"
if command -v redis-cli >/dev/null 2>&1; then
  if [ "$(redis-cli ping 2>/dev/null || true)" != "PONG" ]; then
    echo "ERROR: Redis did not respond to PING. Start Redis before deploying."
    exit 1
  fi
  echo "    Redis OK (PONG)"
else
  echo "    WARNING: redis-cli not found; skipping Redis check."
fi

# 5. Start or reload the PM2 apps.
#    If they already exist, reload for zero-downtime; otherwise start fresh.
echo "==> Starting / reloading PM2 apps"
if pm2 describe "${BACKEND_APP}" >/dev/null 2>&1; then
  echo "    Apps already running -> reload"
  pm2 reload "${BACKEND_APP}" "${WORKER_APP}" --update-env
else
  echo "    First start"
  pm2 start "${ECOSYSTEM}" --only "${BACKEND_APP},${WORKER_APP}"
fi

# 6. Persist the process list so it survives reboots.
echo "==> Saving PM2 process list"
pm2 save

echo ""
echo "==> Done. Current status:"
pm2 list
echo ""
echo "Tail logs with:  pm2 logs ${BACKEND_APP}"
echo "If this is a brand-new server, run 'pm2 startup' once and follow its instructions."
