#!/usr/bin/env bash
# Runs the end-to-end smoke test against a fresh local database.
# Usage: npm test   (or: bash scripts/test.sh)
set -uo pipefail
cd "$(dirname "$0")/.."
LOG="$(mktemp)"
rm -rf .wrangler/state
npx wrangler d1 migrations apply anytable-directory --local > /dev/null
printf 'TURNSTILE_DISABLED=true\nSITE_URL=http://localhost:8787\n' > .dev.vars.test
npx wrangler dev --port 8787 --test-scheduled --env-file .dev.vars.test > "$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -f .dev.vars.test' EXIT
for _ in $(seq 1 60); do
  sleep 1
  curl -s -m 2 -o /dev/null http://localhost:8787/style.css && break
done
bash scripts/smoke.sh "$LOG"
