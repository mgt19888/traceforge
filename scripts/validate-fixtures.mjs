import { summarizeTraceSession } from '../packages/core/src/index.js';
import { importTraceSession } from '../packages/importer/src/index.js';

const fixtures = [
  'fixtures/codex-session.json',
  'fixtures/claude-code-session.json',
];

for (const input of fixtures) {
  const session = await importTraceSession(input);
  const summary = summarizeTraceSession(session);
  console.log(JSON.stringify({
    input,
    sessionId: session.sessionId,
    adapter: session.metadata.adapter,
    format: session.source.format,
    totalEvents: summary.totalEvents,
    commandCount: summary.commandCount,
    testCount: summary.testCount,
    diffCount: summary.diffCount,
    failingCommands: summary.failingCommands,
    failingTests: summary.failingTests,
  }, null, 2));
}
