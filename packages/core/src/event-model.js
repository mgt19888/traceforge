export const TRACE_SCHEMA_VERSION = '0.1.0';

export const TRACE_EVENT_KINDS = Object.freeze([
  'prompt',
  'command',
  'tool',
  'file_edit',
  'patch',
  'test',
  'error',
  'outcome',
]);

const KIND_RULES = Object.freeze({
  prompt: {
    required: ['role', 'content'],
    enums: { role: ['user', 'assistant', 'system'] },
  },
  command: {
    required: ['command', 'status'],
    enums: { status: ['planned', 'running', 'passed', 'failed', 'skipped'] },
    numeric: ['exitCode', 'durationMs'],
  },
  tool: {
    required: ['toolName', 'status'],
    enums: { status: ['requested', 'running', 'succeeded', 'failed'] },
  },
  file_edit: {
    required: ['path', 'changeType'],
    enums: { changeType: ['create', 'update', 'delete', 'rename'] },
    numeric: ['linesAdded', 'linesRemoved'],
  },
  patch: {
    required: ['target', 'format', 'diffSummary'],
    enums: { format: ['unified', 'structured'] },
    numeric: ['hunks', 'linesAdded', 'linesRemoved'],
    arrays: ['files'],
  },
  test: {
    required: ['command', 'status'],
    enums: { status: ['passed', 'failed', 'skipped'] },
    numeric: ['passed', 'failed', 'durationMs'],
  },
  error: {
    required: ['message', 'severity'],
    enums: { severity: ['info', 'warning', 'error', 'fatal'] },
  },
  outcome: {
    required: ['status', 'summary'],
    enums: { status: ['partial', 'success', 'failed'] },
    arrays: ['artifactRefs'],
  },
});

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildValidationError(path, message) {
  return { ok: false, path, message };
}

function coerceIsoTimestamp(value, fallback) {
  const candidate = value ?? fallback;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(isNonEmptyString))];
}

function getNumericValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getEventStatus(event) {
  if (event.kind === 'error') {
    return event.data.severity ?? 'error';
  }

  return event.data.status ?? null;
}

function summarizeFrameLabel(event) {
  switch (event.kind) {
    case 'command':
      return event.data.command ?? event.summary;
    case 'test':
      return event.data.command ?? event.summary;
    case 'patch':
      return event.data.diffSummary ?? event.summary;
    case 'file_edit':
      return event.data.path ?? event.summary;
    default:
      return event.summary;
  }
}

function summarizePrompt(event) {
  const content = event.data.content ?? '';
  return isNonEmptyString(content) && content.length > 120
    ? `${content.slice(0, 117)}...`
    : content;
}

function buildCommandRuns(session) {
  return session.events
    .filter((event) => event.kind === 'command')
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      summary: event.summary,
      command: event.data.command,
      cwd: event.data.cwd ?? null,
      status: event.data.status,
      exitCode: getNumericValue(event.data.exitCode),
      durationMs: getNumericValue(event.data.durationMs),
      stdoutSnippet: event.data.stdoutSnippet ?? null,
      stderrSnippet: event.data.stderrSnippet ?? null,
      stdoutRef: event.data.stdoutRef ?? null,
      stderrRef: event.data.stderrRef ?? null,
    }));
}

function buildTestRuns(session) {
  return session.events
    .filter((event) => event.kind === 'test')
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      summary: event.summary,
      command: event.data.command,
      suite: event.data.suite ?? null,
      status: event.data.status,
      passed: getNumericValue(event.data.passed),
      failed: getNumericValue(event.data.failed),
      durationMs: getNumericValue(event.data.durationMs),
      outputRef: event.data.outputRef ?? null,
    }));
}

function buildDiffEntries(session) {
  return session.events
    .filter((event) => event.kind === 'patch' || event.kind === 'file_edit')
    .map((event) => {
      if (event.kind === 'patch') {
        return {
          id: event.id,
          timestamp: event.timestamp,
          kind: event.kind,
          summary: event.summary,
          target: event.data.target,
          format: event.data.format,
          diffSummary: event.data.diffSummary,
          hunks: getNumericValue(event.data.hunks),
          linesAdded: getNumericValue(event.data.linesAdded),
          linesRemoved: getNumericValue(event.data.linesRemoved),
          files: asArray(event.data.files).filter(isNonEmptyString),
          diffRef: event.data.diffRef ?? null,
        };
      }

      return {
        id: event.id,
        timestamp: event.timestamp,
        kind: event.kind,
        summary: event.summary,
        path: event.data.path,
        changeType: event.data.changeType,
        linesAdded: getNumericValue(event.data.linesAdded),
        linesRemoved: getNumericValue(event.data.linesRemoved),
      };
    });
}

function buildReplayFrames(session) {
  const startedAtMs = Date.parse(session.events[0]?.timestamp ?? '');

  return session.events.map((event, index) => {
    const currentMs = Date.parse(event.timestamp);
    const previousMs = index > 0 ? Date.parse(session.events[index - 1].timestamp) : currentMs;

    return {
      sequence: index + 1,
      id: event.id,
      timestamp: event.timestamp,
      kind: event.kind,
      actor: event.actor,
      summary: summarizeFrameLabel(event),
      promptExcerpt: event.kind === 'prompt' ? summarizePrompt(event) : null,
      status: getEventStatus(event),
      offsetMs: Number.isNaN(startedAtMs) || Number.isNaN(currentMs) ? null : Math.max(0, currentMs - startedAtMs),
      gapMs: Number.isNaN(previousMs) || Number.isNaN(currentMs) ? null : Math.max(0, currentMs - previousMs),
      emphasis: ['command', 'patch', 'test', 'error', 'outcome'].includes(event.kind),
    };
  });
}

function buildIssues(session, commands, tests) {
  const errors = session.events
    .filter((event) => event.kind === 'error')
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      category: 'error',
      summary: event.summary,
      severity: event.data.severity,
      source: event.data.source ?? null,
    }));

  const failingCommands = commands
    .filter((command) => command.status === 'failed')
    .map((command) => ({
      id: command.id,
      timestamp: command.timestamp,
      category: 'command',
      summary: command.summary,
      severity: 'error',
      source: command.command,
    }));

  const failingTests = tests
    .filter((test) => test.status === 'failed')
    .map((test) => ({
      id: test.id,
      timestamp: test.timestamp,
      category: 'test',
      summary: test.summary,
      severity: 'error',
      source: test.command,
    }));

  return [...errors, ...failingCommands, ...failingTests].sort((left, right) => {
    return left.timestamp.localeCompare(right.timestamp);
  });
}

export function normalizeTraceEvent(event, sessionId, index) {
  const kind = TRACE_EVENT_KINDS.includes(event?.kind) ? event.kind : 'error';
  const fallbackTimestamp = new Date(Date.UTC(2026, 3, 19, 9, 6, index)).toISOString();
  const normalizedData = isObject(event?.data) ? event.data : {};

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: isNonEmptyString(event?.id) ? event.id : `${sessionId}-${String(index + 1).padStart(4, '0')}`,
    sessionId,
    timestamp: coerceIsoTimestamp(event?.timestamp, fallbackTimestamp),
    kind,
    actor: isNonEmptyString(event?.actor) ? event.actor : 'system',
    summary: isNonEmptyString(event?.summary) ? event.summary : `${kind} event`,
    tags: Array.isArray(event?.tags) ? event.tags.filter(isNonEmptyString) : [],
    data: normalizedData,
  };
}

export function normalizeTraceSession(session) {
  const sessionId = isNonEmptyString(session?.sessionId)
    ? session.sessionId
    : `traceforge-${Date.now()}`;

  const events = Array.isArray(session?.events) ? session.events : [];
  const normalizedEvents = events
    .map((event, index) => normalizeTraceEvent(event, sessionId, index))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    sessionId,
    source: isObject(session?.source)
      ? {
          format: session.source.format ?? 'unknown',
          origin: session.source.origin ?? 'unknown',
          fixture: Boolean(session.source.fixture),
          notes: session.source.notes ?? '',
          ingestedAt: coerceIsoTimestamp(session.source.ingestedAt, new Date().toISOString()),
        }
      : {
          format: 'unknown',
          origin: 'unknown',
          fixture: false,
          notes: '',
          ingestedAt: new Date().toISOString(),
        },
    metadata: isObject(session?.metadata) ? session.metadata : {},
    events: normalizedEvents,
  };
}

export function validateTraceEvent(event) {
  if (!isObject(event)) {
    return buildValidationError('event', 'must be an object');
  }

  for (const field of ['schemaVersion', 'id', 'sessionId', 'timestamp', 'kind', 'actor', 'summary']) {
    if (!isNonEmptyString(event[field])) {
      return buildValidationError(`event.${field}`, 'must be a non-empty string');
    }
  }

  if (!TRACE_EVENT_KINDS.includes(event.kind)) {
    return buildValidationError('event.kind', `must be one of ${TRACE_EVENT_KINDS.join(', ')}`);
  }

  if (!Array.isArray(event.tags)) {
    return buildValidationError('event.tags', 'must be an array');
  }

  if (!isObject(event.data)) {
    return buildValidationError('event.data', 'must be an object');
  }

  const rule = KIND_RULES[event.kind];

  for (const field of rule.required ?? []) {
    if (!isNonEmptyString(event.data[field])) {
      return buildValidationError(`event.data.${field}`, 'must be a non-empty string');
    }
  }

  for (const [field, allowed] of Object.entries(rule.enums ?? {})) {
    if (!allowed.includes(event.data[field])) {
      return buildValidationError(`event.data.${field}`, `must be one of ${allowed.join(', ')}`);
    }
  }

  for (const field of rule.numeric ?? []) {
    const value = event.data[field];
    if (value !== undefined && typeof value !== 'number') {
      return buildValidationError(`event.data.${field}`, 'must be numeric when present');
    }
  }

  for (const field of rule.arrays ?? []) {
    const value = event.data[field];
    if (value !== undefined && !Array.isArray(value)) {
      return buildValidationError(`event.data.${field}`, 'must be an array when present');
    }
  }

  return { ok: true, value: event };
}

export function validateTraceSession(session) {
  if (!isObject(session)) {
    return buildValidationError('session', 'must be an object');
  }

  for (const field of ['schemaVersion', 'sessionId']) {
    if (!isNonEmptyString(session[field])) {
      return buildValidationError(`session.${field}`, 'must be a non-empty string');
    }
  }

  if (!isObject(session.source)) {
    return buildValidationError('session.source', 'must be an object');
  }

  if (!Array.isArray(session.events)) {
    return buildValidationError('session.events', 'must be an array');
  }

  for (let index = 0; index < session.events.length; index += 1) {
    const validation = validateTraceEvent(session.events[index]);
    if (!validation.ok) {
      return buildValidationError(`session.events[${index}].${validation.path}`, validation.message);
    }
  }

  return { ok: true, value: session };
}

export function buildTraceObservability(session) {
  const commands = buildCommandRuns(session);
  const tests = buildTestRuns(session);
  const diffs = buildDiffEntries(session);
  const replayFrames = buildReplayFrames(session);
  const actorCounts = {};
  const tagCounts = {};
  const filesTouched = [];
  const artifactRefs = [];

  for (const event of session.events) {
    actorCounts[event.actor] = (actorCounts[event.actor] ?? 0) + 1;

    for (const tag of event.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }

    if (event.kind === 'file_edit' && isNonEmptyString(event.data.path)) {
      filesTouched.push(event.data.path);
    }

    if (event.kind === 'patch') {
      filesTouched.push(...asArray(event.data.files));
      if (isNonEmptyString(event.data.diffRef)) {
        artifactRefs.push(event.data.diffRef);
      }
    }

    if (event.kind === 'command') {
      if (isNonEmptyString(event.data.stdoutRef)) {
        artifactRefs.push(event.data.stdoutRef);
      }
      if (isNonEmptyString(event.data.stderrRef)) {
        artifactRefs.push(event.data.stderrRef);
      }
    }

    if (event.kind === 'test' && isNonEmptyString(event.data.outputRef)) {
      artifactRefs.push(event.data.outputRef);
    }

    if (event.kind === 'outcome') {
      artifactRefs.push(...asArray(event.data.artifactRefs));
    }
  }

  const totalSpanMs = replayFrames.at(-1)?.offsetMs ?? 0;
  const largestGapMs = replayFrames.reduce((largest, frame) => {
    return Math.max(largest, frame.gapMs ?? 0);
  }, 0);

  return {
    metrics: {
      prompts: session.events.filter((event) => event.kind === 'prompt').length,
      commands: commands.length,
      failingCommands: commands.filter((command) => command.status === 'failed').length,
      tests: tests.length,
      failingTests: tests.filter((test) => test.status === 'failed').length,
      diffs: diffs.length,
      filesTouched: uniqueStrings(filesTouched).length,
      tools: session.events.filter((event) => event.kind === 'tool').length,
      totalSpanMs,
      largestGapMs,
    },
    actors: actorCounts,
    tags: Object.entries(tagCounts)
      .sort((left, right) => right[1] - left[1])
      .map(([tag, count]) => ({ tag, count })),
    commands,
    tests,
    diffs,
    filesTouched: uniqueStrings(filesTouched),
    artifactRefs: uniqueStrings(artifactRefs),
    replay: {
      totalSpanMs,
      largestGapMs,
      frames: replayFrames,
    },
    issues: buildIssues(session, commands, tests),
  };
}

export function summarizeTraceSession(session) {
  const counts = Object.fromEntries(TRACE_EVENT_KINDS.map((kind) => [kind, 0]));

  for (const event of session.events) {
    counts[event.kind] += 1;
  }

  const observability = buildTraceObservability(session);

  return {
    sessionId: session.sessionId,
    totalEvents: session.events.length,
    startedAt: session.events[0]?.timestamp ?? null,
    endedAt: session.events.at(-1)?.timestamp ?? null,
    counts,
    errorCount: counts.error,
    actorCounts: observability.actors,
    filesTouched: observability.metrics.filesTouched,
    commandCount: observability.metrics.commands,
    testCount: observability.metrics.tests,
    diffCount: observability.metrics.diffs,
    failingCommands: observability.metrics.failingCommands,
    failingTests: observability.metrics.failingTests,
    replaySpanMs: observability.metrics.totalSpanMs,
  };
}
