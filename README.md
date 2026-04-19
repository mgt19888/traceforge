# TraceForge

TraceForge is a local-first session forensics tool for agentic coding runs. This foundation now exposes four clear seams:

- `packages/importer`: turns raw session inputs into a normalized trace session and now includes a realistic Codex adapter boundary.
- `packages/core`: owns the unified event model plus replay/observability derivations used by the API and UI.
- `packages/cli`: ingests traces and serves a local Web UI plus JSON observability endpoints without external services.
- `packages/ui`: renders a replay-oriented browser view with timeline, commands, tests, diffs, and issue sections.

## Quick Start

```bash
node packages/cli/src/main.js ingest fixtures/codex-session.json artifacts/latest-session.json
node packages/cli/src/main.js serve --trace artifacts/latest-session.json --port 4310
```

Open `http://127.0.0.1:4310` to inspect the trace.

## Current Scope

- Unified event/session schema covering prompt, command, tool, file edit, patch, test, error, and outcome events.
- Codex-shaped fixture and adapter path so importer/UI work can continue without waiting for a final export format.
- Replay/observability layer that derives command runs, tests, diffs, issues, files touched, and artifact references.
- Local UI sections for timeline replay, shell commands, test runs, diff activity, and surfaced issues.

See `docs/traceforge-architecture.md` for the design and next steps.
