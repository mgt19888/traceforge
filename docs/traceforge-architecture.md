# TraceForge Architecture Note

## Why this split

- `packages/importer` is the boundary between volatile upstream session formats and TraceForge's stable internal model.
- `packages/core` defines the event/session schema, normalization rules, replay/observability derivations, and summary helpers used everywhere else.
- `packages/cli` is the operator surface for ingesting traces and serving a local UI plus JSON API endpoints.
- `packages/ui` renders the normalized session with timeline and activity-specific panes.

## Unified event model

TraceForge uses one event envelope with a discriminated `kind` and a `data` payload.

- Common envelope fields: `id`, `sessionId`, `timestamp`, `kind`, `actor`, `summary`, `tags`.
- Supported kinds in this first pass:
  - `prompt`
  - `command`
  - `tool`
  - `file_edit`
  - `patch`
  - `test`
  - `error`
  - `outcome`

The JSON schemas live in `packages/core/schema/trace-event.schema.json` and `packages/core/schema/trace-session.schema.json`.

## Current ingest flow

1. Importer reads NDJSON, generic JSON, Codex-shaped session documents, or Claude Code-shaped transcript documents.
2. The Codex adapter maps `steps` such as prompts, commands, plan updates, patches, and tests into the stable event model.
3. The Claude Code adapter maps role/content transcripts plus `tool_use`/`tool_result` pairs and explicit patch/test/outcome records into the same event model.
4. Core normalizes missing IDs/session IDs, sorts events by timestamp, validates the result, and derives replay/observability indexes.
5. CLI writes normalized artifacts and/or serves them through `/api/session` and `/api/observability`.
6. UI renders the timeline plus command/test/diff/issues panes from the same normalized payload.

## Adapter boundaries

- `packages/importer/src/adapters/codex.js`: handles Codex session documents with `steps` and Codex-style raw step arrays.
- `packages/importer/src/adapters/claude-code.js`: handles Claude Code session documents with `transcript`/`messages`/`entries` and Claude-style record arrays.
- Both adapters emit the same TraceForge event kinds so the rest of the stack stays format-agnostic.

## Current Claude Code limitations

- Supported today: JSON transcript exports, record arrays, text blocks, `tool_use`/`tool_result` pairs, and explicit `file_edit`, `apply_patch`, `test_result`, `error`, and `outcome` entries.
- Not supported yet: raw streaming delta logs, local Claude Code state directories, or full artifact body persistence for stdout/stderr/patch payloads.

## Replay and observability data

The core layer now derives a reusable observability object alongside the simple summary. It currently includes:

- `metrics`: counts for commands, tests, diffs, files touched, failures, and replay span.
- `commands`: shell-oriented command records with status, exit codes, durations, and referenced stdout/stderr artifacts.
- `tests`: validation runs with pass/fail counts and output references.
- `diffs`: patch and file-edit activity suitable for diff panes.
- `replay.frames`: a chronological replay strip with event offsets, inter-event gaps, and emphasis markers.
- `issues` and `artifactRefs`: surfaced warnings/failures and referenced outputs.

## Immediate next steps

1. Replace the synthetic fixtures with captured real Codex and Claude Code exports once the upstream formats stabilize.
2. Persist larger artifacts such as raw command stdout, patch blobs, screenshots, and screenshots manifests alongside the session.
3. Add richer validation and indexing, likely via SQLite or DuckDB for multi-session search.
4. Add deep linking between timeline events and command/test/diff panes.
5. Add snapshot tests over importer fixtures and API payloads.
