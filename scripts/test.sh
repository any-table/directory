#!/usr/bin/env bash
# Runs the end-to-end smoke test against a fresh local database.
# Usage: npm test   (or: bash scripts/test.sh)
set -uo pipefail
cd "$(dirname "$0")/.."
LOG="$(mktemp)"
rm -rf .wrangler/state
npx wrangler d1 migrations apply anytable-directory --local > /dev/null
# Low mail caps so the smoke test can reach them.
printf 'TURNSTILE_DISABLED=true\nMAIL_LOG_ONLY=true\nSITE_URL=http://localhost:8787\nMAIL_DAILY_CAP=8\nMAIL_MESSAGE_CAP=2\n' > .dev.vars.test
if curl -s -m 2 -o /dev/null http://localhost:8787/; then
  echo "Something is already listening on port 8787. Stop it and run the tests again." >&2
  exit 1
fi
# Its own process group, so the cleanup stops wrangler's child processes too.
setsid npx wrangler dev --port 8787 --test-scheduled --env-file .dev.vars.test > "$LOG" 2>&1 &
PID=$!
trap 'kill -- -$PID 2>/dev/null; rm -f .dev.vars.test' EXIT
for _ in $(seq 1 60); do
  sleep 1
  curl -s -m 2 -o /dev/null http://localhost:8787/style.css && break
done
bash scripts/smoke.sh "$LOG"
