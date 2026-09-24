#!/usr/bin/env bash
# Install, build and start base-service.
#   ./run.sh           -> uses .env (STORAGE=postgres starts the DB container first)
#   ./run.sh --memory  -> in-memory storage, no database needed
#   ./run.sh --docker  -> everything (DB + service) in Docker via docker compose
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[run] created .env from .env.example - edit the credentials if you want"
fi

if [ "${1:-}" = "--docker" ]; then
  exec docker compose up --build
fi

if [ "${1:-}" = "--memory" ]; then
  export STORAGE=memory
fi

STORAGE_MODE="${STORAGE:-$(grep -E '^STORAGE=' .env | cut -d= -f2 || true)}"
if [ "$STORAGE_MODE" = "postgres" ]; then
  echo "[run] starting PostgreSQL container (named volume base_pgdata)..."
  docker compose up -d db
fi

echo "[run] installing dependencies..."
npm ci
echo "[run] building..."
npm run build
echo "[run] starting..."
exec npm start
