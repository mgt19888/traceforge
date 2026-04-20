# TraceForge

TraceForge is a local-first session forensics tool for agentic coding runs. This foundation now exposes four clear seams:

- `packages/importer`: turns raw session inputs into a normalized trace session and now includes separate Codex and Claude Code adapter boundaries.
- `packages/core`: owns the unified event model plus replay/observability derivations used by the API and UI.
- `packages/cli`: ingests traces and serves a local Web UI plus JSON observability endpoints without external services.
- `packages/ui`: renders a replay-oriented browser view with timeline, commands, tests, diffs, and issue sections.

## Quick Start

```bash
node packages/cli/src/main.js ingest fixtures/codex-session.json artifacts/latest-session.json
node packages/cli/src/main.js serve --trace artifacts/latest-session.json --port 4310
npm run traceforge:validate-fixtures
```

Open `http://127.0.0.1:4310` to inspect the trace.

## Current Scope

- Unified event/session schema covering prompt, command, tool, file edit, patch, test, error, and outcome events.
- Dual-adapter ingest for Codex-shaped sessions (`steps`) and Claude Code-shaped transcripts (`role` messages with `text`, `tool_use`, and `tool_result` blocks).
- Replay/observability layer that derives command runs, tests, diffs, issues, files touched, and artifact references.
- Local UI sections for timeline replay, shell commands, test runs, diff activity, and surfaced issues.

## Adapter Notes

- Codex support targets session JSON documents and record arrays shaped like the current `fixtures/codex-session.json` export.
- Claude Code support targets JSON transcript documents and record arrays with role-based entries and Anthropic-style content blocks.
- Current limitation: raw Claude Code streaming deltas, local state folders, and full patch/stdout payload persistence are not implemented yet.

See `docs/traceforge-architecture.md` for the design and next steps.
