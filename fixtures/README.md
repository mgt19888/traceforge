# Trace Fixtures

Use `fixtures/codex-session.json` for the richer local demo and keep `fixtures/mock-session.ndjson` as the generic event-stream baseline.

## Included fixtures

- `fixtures/codex-session.json`: realistic Codex-shaped session document with `steps`, command/test outputs, patch metadata, and artifact references.
- `fixtures/mock-session.ndjson`: generic normalized-event fixture that still exercises the base importer path.

## Intended future sources

- Codex prompt/response transcripts.
- Shell command executions and exit codes.
- Tool invocation summaries.
- File edits and patch metadata.
- Test executions and outcomes.

## Fixture notes

- Goal: exercise the importer adapter boundary plus the stable TraceForge event model.
- Expectation: importer maps both fixture styles into one normalized session JSON for the CLI and UI.
- Limitation: patch bodies and full stdout are still referenced as artifacts rather than persisted inline.
