# Trace Fixtures

Use `fixtures/codex-session.json` and `fixtures/claude-code-session.json` for the richer local demos, and keep `fixtures/mock-session.ndjson` as the generic event-stream baseline.

## Included fixtures

- `fixtures/codex-session.json`: realistic Codex-shaped session document with `steps`, command/test outputs, patch metadata, and artifact references.
- `fixtures/claude-code-session.json`: Claude Code-shaped transcript document with `role` messages, Anthropic-style `text`/`tool_use`/`tool_result` blocks, plus explicit patch/outcome records.
- `fixtures/mock-session.ndjson`: generic normalized-event fixture that still exercises the base importer path.

## Intended future sources

- Codex prompt/response transcripts.
- Claude Code role/content transcripts and tool-use/tool-result exchanges.
- Shell command executions and exit codes.
- Tool invocation summaries.
- File edits and patch metadata.
- Test executions and outcomes.

## Fixture notes

- Goal: exercise both adapter boundaries plus the stable TraceForge event model.
- Expectation: importer maps Codex and Claude Code fixture styles into one normalized session JSON for the CLI and UI.
- Limitation: Claude Code support currently targets JSON transcript exports and record arrays; raw streaming deltas and local session-state directories are not ingested yet.
- Limitation: patch bodies and full stdout are still referenced as artifacts rather than persisted inline.
