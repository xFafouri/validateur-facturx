#!/usr/bin/env bash
#
# Starts the API and the web app together, with the workspace `.env` exported.
#
# Both apps read that file at runtime - the API through Nest's ConfigModule, the web app through
# `next.config.mjs` - but a launch *port* is settled before either of those runs: Next's CLI picks
# its port from the environment at argv-parse time. So the file is exported here, in the shell,
# where it can reach both the CLI flags and the processes.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
else
  echo "Aucun .env à la racine - copiez .env.example et adaptez-le." >&2
fi

WEB_PORT="${PORT:-3000}"
API_PORT="${API_PORT:-3001}"

echo "API : http://127.0.0.1:${API_PORT}"
echo "Web : http://localhost:${WEB_PORT}"
echo

pnpm --filter @facturx/api start &
API_PID=$!
# Stop the API when the web app exits, so Ctrl-C does not leave a process holding the port.
trap 'kill ${API_PID} 2>/dev/null || true' EXIT INT TERM

pnpm --filter @facturx/web dev
