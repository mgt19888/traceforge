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

1. Importer reads NDJSON, generic JSON, or a Codex-shaped session document.
2. The Codex adapter maps `steps` such as prompts, commands, plan updates, patches, and tests into the stable event model.
3. Core normalizes missing IDs/session IDs, sorts events by timestamp, validates the result, and derives replay/observability indexes.
4. CLI writes normalized artifacts and/or serves them through `/api/session` and `/api/observability`.
5. UI renders the timeline plus command/test/diff/issues panes from the same normalized payload.

## Replay and observability data

The core layer now derives a reusable observability object alongside the simple summary. It currently includes:

- `metrics`: counts for commands, tests, diffs, files touched, failures, and replay span.
- `commands`: shell-oriented command records with status, exit codes, durations, and referenced stdout/stderr artifacts.
- `tests`: validation runs with pass/fail counts and output references.
- `diffs`: patch and file-edit activity suitable for diff panes.
- `replay.frames`: a chronological replay strip with event offsets, inter-event gaps, and emphasis markers.
- `issues` and `artifactRefs`: surfaced warnings/failures and referenced outputs.

## Immediate next steps

1. Replace the synthetic Codex fixture with a captured real session export once a stable upstream format exists.
2. Persist larger artifacts such as raw command stdout, patch blobs, screenshots, and screenshots manifests alongside the session.
3. Add richer validation and indexing, likely via SQLite or DuckDB for multi-session search.
4. Add deep linking between timeline events and command/test/diff panes.
5. Add snapshot tests over importer fixtures and API payloads.
