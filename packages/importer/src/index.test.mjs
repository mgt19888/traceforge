import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeTraceSession, validateTraceSession } from '../../core/src/index.js';
import { importTraceSession } from './index.js';

const FIXTURE_CASES = [
  {
    input: 'fixtures/codex-session.json',
    adapter: 'codex',
    format: 'codex-session',
    sessionId: 'codex-traceforge-wave-2',
    totalEvents: 10,
    commandCount: 2,
    testCount: 2,
    diffCount: 2,
    failingCommands: 0,
    failingTests: 0,
    eventKinds: [
      'prompt',
      'prompt',
      'command',
      'tool',
      'file_edit',
      'patch',
      'command',
      'test',
      'test',
      'outcome',
    ],
  },
  {
    input: 'fixtures/claude-code-session.json',
    adapter: 'claude-code',
    format: 'claude-code-session',
    sessionId: 'claude-traceforge-dual-adapter',
    totalEvents: 12,
    commandCount: 1,
    testCount: 1,
    diffCount: 2,
    failingCommands: 0,
    failingTests: 0,
    eventKinds: [
      'prompt',
      'prompt',
      'prompt',
      'command',
      'prompt',
      'prompt',
      'file_edit',
      'patch',
      'prompt',
      'prompt',
      'test',
      'outcome',
    ],
  },
];

for (const fixture of FIXTURE_CASES) {
  test(`importTraceSession normalizes ${fixture.adapter} fixture`, async () => {
    const session = await importTraceSession(fixture.input);
    const summary = summarizeTraceSession(session);
    const validation = validateTraceSession(session);

    assert.equal(validation.ok, true);
    assert.equal(session.sessionId, fixture.sessionId);
    assert.equal(session.metadata.adapter, fixture.adapter);
    assert.equal(session.source.format, fixture.format);
    assert.equal(summary.totalEvents, fixture.totalEvents);
    assert.equal(summary.commandCount, fixture.commandCount);
    assert.equal(summary.testCount, fixture.testCount);
    assert.equal(summary.diffCount, fixture.diffCount);
    assert.equal(summary.failingCommands, fixture.failingCommands);
    assert.equal(summary.failingTests, fixture.failingTests);
    assert.deepEqual(session.events.map((event) => event.kind), fixture.eventKinds);
    assert.equal(session.events.at(0)?.kind, 'prompt');
    assert.equal(session.events.at(-1)?.kind, 'outcome');
  });
}

test('dual-adapter fixtures preserve normalized replay ordering invariants', async () => {
  const sessions = await Promise.all(FIXTURE_CASES.map((fixture) => importTraceSession(fixture.input)));

  for (const session of sessions) {
    const timestamps = session.events.map((event) => event.timestamp);
    const sortedTimestamps = [...timestamps].sort((left, right) => left.localeCompare(right));

    assert.deepEqual(timestamps, sortedTimestamps);
    assert.ok(session.events.every((event) => event.sessionId === session.sessionId));
    assert.ok(session.events.every((event) => Array.isArray(event.tags)));
  }
});
