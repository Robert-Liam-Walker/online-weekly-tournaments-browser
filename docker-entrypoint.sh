#!/bin/sh
set -e
cd /app/apps/api
if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[entrypoint] applying migrations"
  npx prisma migrate deploy
else
  echo "[entrypoint] no migrations directory; pushing schema"
  npx prisma db push --skip-generate
fi
exec node dist/index.js
