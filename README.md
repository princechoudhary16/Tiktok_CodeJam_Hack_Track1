# Tiktok CodeJam — Hack Track 1

## Project Overview
Agent Launchpad: a self-healing middleware for agent runs. This repo contains the CodeJam submission implementing a middleware layer that observes agent executions, classifies failures, and performs automated recovery actions while preserving auditability and operator control.

## What it does
- Observes run telemetry and captures inputs, outputs, environment snapshots, and errors.
- Detects failure classes (transient infra, resource limits, bad inputs, hallucinations) using rules and lightweight models.
- Recovers automatically using composable handlers (retry/backoff, environment reset, prompt sanitization, model fallback).
- Learns which remedies work and adapts policies.
- Surfaces audit trails and escalates unrecoverable cases.

## Architecture
- `server/`: middleware service (runner integrations, recovery handlers, policies).
- `web/`: minimal UI for run inspection and policy controls.
- `deploy/`: terraform and templates for deploying to cloud (example configs).
- `scripts/`: helper scripts for local bootstrap and deployment.

Integration points:
- Runner: the middleware sits between orchestrator and agent runner via HTTP/gRPC adapter.
- Model providers: supports fallback to alternative LLM endpoints when needed.
- Observability: structured logs and traces (OpenTelemetry-compatible) for replay and debugging.

## How we built it
- Pragmatic stack: TypeScript/Node for the middleware and web UI, containerized for portability.
- Instrumentation: per-run metadata capture, structured logs, and traces.
- Failure classification: rule-based heuristics with a small ML classifier trained on historical runs.
- Recovery handlers: modular functions that apply a safe change and record outcomes.

## Key files and folders
- `server/src/` — core middleware and handlers.
- `web/src/` — React + Vite UI to inspect runs.
- `deploy/` — example cloud deployment templates.
- `scripts/bootstrap-local.sh` — local bootstrap steps.

## Running locally
Prereqs: Node.js (18+), Docker (optional), git

1. Install dependencies:

```bash
cd server
npm install
cd ../web
npm install
```

2. Run server locally (development):

```bash
cd server
npm run dev
```

3. Run web UI:

```bash
cd web
npm run dev
```

4. Bootstrap local runner (uses Docker):

```bash
./scripts/bootstrap-local.sh
```

## Tests
- Unit tests are in `server/src` and can be run with `npm test` in the server folder.

## How integration works (details)
1. Orchestrator sends run requests to middleware adapter.
2. Middleware records request metadata and forwards to runner.
3. Runner executes agent; middleware tails logs and metrics.
4. If error occurs, middleware classifies and selects a handler.
5. Handler performs a safe recovery action and retries or escalates.
6. All actions are recorded for audit and feedback into learning heuristics.

## Extending the system
- Add new recovery handlers under `server/src/handlers` as small, idempotent functions.
- Add instrumentation updates when introducing new runners or environments.
- Policy tuning: policies are stored in `server/config/policies` and can be changed per workspace.

## Deployment
- Build images with `docker build` in `server` and `web` directories.
- Example `docker-compose.yml` is at project root for local integration.
- For cloud, see `deploy/volcengine` for example Terraform templates.

## Contributions
- Please open pull requests against this fork. Maintain small, focused changes and include tests for new handlers.

## License
See `LICENSE` at project root.

## Contact
Project maintainers: Prince Choudhary (repo owner)

README generated for the Devpost submission and repo distribution.
 
## Media and Demo
Media assets (screenshots, transcript, and demo scripts) are available under `docs/media` and `scripts/`:

- `docs/media/` — place screenshots and thumbnail here before publishing.
- `docs/media/transcript.txt` — demo narration transcript.
- `scripts/demo-success.sh` — reproducible successful-run demo.
- `scripts/demo-failure.sh` — reproducible failing-run demo exercising recovery handlers.

To run the demos locally:

```bash
cd /path/to/project
npm install
# open a terminal and run a demo (server will be started and stopped by the script)
bash scripts/demo-success.sh
# or
bash scripts/demo-failure.sh
```

Please crop or blur any sensitive data in screenshots before uploading.

