#!/usr/bin/env bash
set -euo pipefail
# Demo script: run a successful agent run (simulated) and show telemetry
echo "Running demo: successful run"
cd "$(dirname "$0")/.."
# run the server in background (assumes npm deps installed)
npm run start -w @launchpad/server &
SERVER_PID=$!
sleep 1

echo "Triggering a sample agent run via HTTP POST to the middleware"
curl -s -X POST http://localhost:3000/api/runs -H 'Content-Type: application/json' -d '{"agentId":"demo-agent","input":"say hello"}' | jq '.' || true

sleep 1
echo "Stopping server"
kill $SERVER_PID || true

echo "Demo complete"
