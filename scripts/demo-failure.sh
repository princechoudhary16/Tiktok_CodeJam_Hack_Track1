#!/usr/bin/env bash
set -euo pipefail
# Demo script: run a failing agent run (simulated) and show automated recovery
echo "Running demo: failing run with automated recovery"
cd "$(dirname "$0")/.."

# run the server in background (assumes npm deps installed)
npm run start -w @launchpad/server &
SERVER_PID=$!
sleep 1

echo "Triggering a simulated failing run"
# This endpoint is expected to trigger a controlled failure and recovery handlers
curl -s -X POST http://localhost:3000/api/runs -H 'Content-Type: application/json' -d '{"agentId":"demo-agent","input":"cause_failure"}' | jq '.' || true

sleep 2
echo "Stop server"
kill $SERVER_PID || true

echo "Demo failure complete"
