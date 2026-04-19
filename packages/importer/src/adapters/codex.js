import path from 'node:path';

const CODEX_SESSION_FORMAT = 'codex-session';
const KNOWN_CODEX_STEP_TYPES = new Set([
  'user_message',
  'assistant_message',
  'system_message',
  'exec_command',
  'tool_call',
  'plan_update',
  'file_edit',
  'apply_patch',
  'diff',
  'test_result',
  'error',
  'outcome',
]);

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTimestamp(value, fallback) {
  const date = new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function buildSessionId(sourcePath) {
  const stem = path.basename(sourcePath).replace(/\.[^.]+$/, '');
  return `codex-${stem}`;
}

function buildTags(baseTags, type) {
  const tags = new Set(['adapter:codex']);

  for (const tag of asArray(baseTags)) {
    if (isNonEmptyString(tag)) {
      tags.add(tag.trim());
    }
  }

  if (isNonEmptyString(type)) {
    tags.add(`codex:${type}`);
  }

  return [...tags];
}

function mapCommandStatus(status) {
  switch (status) {
    case 'planned':
    case 'queued':
      return 'planned';
    case 'running':
    case 'started':
      return 'running';
    case 'failed':
    case 'error':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'passed':
    case 'success':
    case 'succeeded':
    case 'completed':
    default:
      return 'passed';
  }
}

function mapToolStatus(status) {
  switch (status) {
    case 'requested':
    case 'queued':
      return 'requested';
    case 'running':
    case 'started':
      return 'running';
    case 'failed':
    case 'error':
      return 'failed';
    case 'succeeded':
    case 'success':
    case 'completed':
    default:
      return 'succeeded';
  }
}

function mapTestStatus(status) {
  switch (status) {
    case 'failed':
    case 'error':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'passed':
    case 'success':
    case 'succeeded':
    case 'completed':
    default:
      return 'passed';
  }
}

function mapOutcomeStatus(status) {
  switch (status) {
    case 'failed':
    case 'error':
      return 'failed';
    case 'partial':
    case 'degraded':
      return 'partial';
    case 'success':
    case 'succeeded':
    case 'completed':
    default:
      return 'success';
  }
}

function mapSeverity(severity) {
  switch (severity) {
    case 'info':
    case 'warning':
    case 'error':
    case 'fatal':
      return severity;
    default:
      return 'error';
  }
}

function mapChangeType(changeType) {
  switch (changeType) {
    case 'create':
    case 'update':
    case 'delete':
    case 'rename':
      return changeType;
    default:
      return 'update';
  }
}

function buildMessageEvent(step, actor, role, fallbackSummary, context) {
  return {
    timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
    kind: 'prompt',
    actor,
    summary: step.summary ?? fallbackSummary,
    tags: buildTags(step.tags, step.type),
    data: {
      role,
      content: step.content ?? step.text ?? fallbackSummary,
      channel: step.channel ?? 'chat',
      rawStepType: step.type,
    },
  };
}

function buildPatchFiles(files) {
  return asArray(files)
    .map((entry) => {
      if (isNonEmptyString(entry)) {
        return entry;
      }
      if (isObject(entry) && isNonEmptyString(entry.path)) {
        return entry.path;
      }
      return null;
    })
    .filter(Boolean);
}

function mapCodexStep(step, context) {
  const type = isNonEmptyString(step?.type) ? step.type : 'tool_call';

  switch (type) {
    case 'user_message':
      return buildMessageEvent(step, 'user', 'user', 'User prompt', context);
    case 'assistant_message':
      return buildMessageEvent(step, 'assistant', 'assistant', 'Assistant response', context);
    case 'system_message':
      return buildMessageEvent(step, 'system', 'system', 'System message', context);
    case 'exec_command':
      return {
        timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
        kind: 'command',
        actor: step.actor ?? 'assistant',
        summary: step.summary ?? `Run ${step.command ?? 'shell command'}`,
        tags: buildTags(step.tags, type),
        data: {
          command: step.command ?? 'unknown command',
          cwd: step.cwd ?? context.cwd,
          status: mapCommandStatus(step.status),
          exitCode: typeof step.exit_code === 'number' ? step.exit_code : step.exitCode,
          durationMs: typeof step.duration_ms === 'number' ? step.duration_ms : step.durationMs,
          stdoutSnippet: step.stdout_snippet ?? step.stdoutSnippet,
          stderrSnippet: step.stderr_snippet ?? step.stderrSnippet,
          stdoutRef: step.stdout_ref ?? step.stdoutRef,
          stderrRef: step.stderr_ref ?? step.stderrRef,
          rawStepType: type,
        },
      };
    case 'tool_call':
    case 'plan_update':
      return {
        timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
        kind: 'tool',
        actor: step.actor ?? 'assistant',
        summary: step.summary ?? `Use ${step.tool_name ?? step.toolName ?? type}`,
        tags: buildTags(step.tags, type),
        data: {
          toolName: step.tool_name ?? step.toolName ?? type,
          status: mapToolStatus(step.status),
          inputSummary: step.input_summary ?? step.inputSummary ?? 'No input summary captured.',
          outputSummary: step.output_summary ?? step.outputSummary ?? 'No output summary captured.',
          callId: step.call_id ?? step.callId,
          rawStepType: type,
        },
      };
    case 'file_edit':
      return {
        timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
        kind: 'file_edit',
        actor: step.actor ?? 'assistant',
        summary: step.summary ?? `Edit ${step.path ?? 'workspace file'}`,
        tags: buildTags(step.tags, type),
        data: {
          path: step.path ?? 'unknown',
          changeType: mapChangeType(step.change_type ?? step.changeType),
          language: step.language,
          linesAdded: typeof step.lines_added === 'number' ? step.lines_added : step.linesAdded,
          linesRemoved: typeof step.lines_removed === 'number' ? step.lines_removed : step.linesRemoved,
          rawStepType: type,
        },
      };
    case 'apply_patch':
    case 'diff':
      return {
        timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
        kind: 'patch',
        actor: step.actor ?? 'assistant',
        summary: step.summary ?? 'Apply repository patch',
        tags: buildTags(step.tags, type),
        data: {
          target: step.target ?? 'workspace',
          format: step.format === 'structured' ? 'structured' : 'unified',
          diffSummary: step.diff_summary ?? step.diffSummary ?? 'Patch applied',
          hunks: typeof step.hunks === 'number' ? step.hunks : undefined,
          files: buildPatchFiles(step.files),
          linesAdded: typeof step.lines_added === 'number' ? step.lines_added : step.linesAdded,
          linesRemoved: typeof step.lines_removed === 'number' ? step.lines_removed : step.linesRemoved,
          diffRef: step.diff_ref ?? step.diffRef,
          rawStepType: type,
        },
      };
    case 'test_result':
      return {
        timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
        kind: 'test',
        actor: step.actor ?? 'assistant',
        summary: step.summary ?? `Run ${step.command ?? 'tests'}`,
        tags: buildTags(step.tags, type),
        data: {
          command: step.command ?? 'unknown test command',
          status: mapTestStatus(step.status),
          passed: typeof step.passed === 'number' ? step.passed : 0,
          failed: typeof step.failed === 'number' ? step.failed : 0,
          durationMs: typeof step.duration_ms === 'number' ? step.duration_ms : step.durationMs,
          suite: step.suite,
          outputRef: step.output_ref ?? step.outputRef,
          rawStepType: type,
        },
      };
    case 'error':
      return {
        timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
        kind: 'error',
        actor: step.actor ?? 'system',
        summary: step.summary ?? 'Codex session error',
        tags: buildTags(step.tags, type),
        data: {
          message: step.message ?? 'Unknown error',
          severity: mapSeverity(step.severity),
          source: step.source ?? 'codex-adapter',
          rawStepType: type,
        },
      };
    case 'outcome':
      return {
        timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
        kind: 'outcome',
        actor: step.actor ?? 'assistant',
        summary: step.summary ?? 'Codex session outcome',
        tags: buildTags(step.tags, type),
        data: {
          status: mapOutcomeStatus(step.status),
          summary: step.result_summary ?? step.resultSummary ?? step.summary ?? 'Outcome recorded',
          artifactRefs: asArray(step.artifact_refs ?? step.artifactRefs).filter(isNonEmptyString),
          rawStepType: type,
        },
      };
    default:
      return {
        timestamp: normalizeTimestamp(step.timestamp, context.fallbackTimestamp),
        kind: 'tool',
        actor: step.actor ?? 'assistant',
        summary: step.summary ?? `Record ${type}`,
        tags: buildTags([...asArray(step.tags), 'unmapped'], type),
        data: {
          toolName: type,
          status: mapToolStatus(step.status),
          inputSummary: step.input_summary ?? step.inputSummary ?? 'Adapter preserved an unsupported Codex step.',
          outputSummary: step.output_summary ?? step.outputSummary ?? 'Stored under tool event until a dedicated mapping exists.',
          rawStepType: type,
        },
      };
  }
}

function buildCodexSession(document, sourcePath) {
  const fallbackStart = new Date(Date.UTC(2026, 3, 19, 9, 34, 0)).toISOString();
  const sessionId = document.session_id ?? document.sessionId ?? buildSessionId(sourcePath);
  const startedAt = normalizeTimestamp(document.started_at ?? document.startedAt, fallbackStart);
  const steps = asArray(document.steps).map((step, index) => {
    const fallbackTimestamp = new Date(Date.parse(startedAt) + index * 5000).toISOString();
    return mapCodexStep(step, {
      cwd: document.cwd,
      fallbackTimestamp,
    });
  });

  return {
    sessionId,
    source: {
      format: CODEX_SESSION_FORMAT,
      origin: sourcePath,
      fixture: sourcePath.includes('fixtures'),
      notes: 'Imported through the Codex session adapter.',
      ingestedAt: new Date().toISOString(),
    },
    metadata: {
      importedFrom: sourcePath,
      adapter: 'codex',
      provider: document.provider ?? 'codex',
      model: document.model ?? null,
      runId: document.run_id ?? document.runId ?? null,
      cwd: document.cwd ?? null,
      startedAt,
      endedAt: normalizeTimestamp(document.ended_at ?? document.endedAt, startedAt),
      tags: asArray(document.tags).filter(isNonEmptyString),
    },
    events: steps,
  };
}

export function isCodexSessionDocument(value) {
  return isObject(value)
    && (value.format === CODEX_SESSION_FORMAT
      || value.provider === 'codex'
      || (isNonEmptyString(value.session_id ?? value.sessionId) && Array.isArray(value.steps))
      || (Array.isArray(value.steps) && value.steps.some((step) => KNOWN_CODEX_STEP_TYPES.has(step?.type))));
}

export function isCodexStepRecordList(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => isObject(entry) && !('kind' in entry))
    && value.some((entry) => KNOWN_CODEX_STEP_TYPES.has(entry.type));
}

export function importCodexSessionDocument(document, sourcePath) {
  return buildCodexSession(document, sourcePath);
}

export function importCodexStepRecords(records, sourcePath) {
  const sessionDocument = {
    format: CODEX_SESSION_FORMAT,
    provider: 'codex',
    session_id: records.find((record) => isNonEmptyString(record.session_id ?? record.sessionId))?.session_id
      ?? records.find((record) => isNonEmptyString(record.sessionId))?.sessionId,
    run_id: records.find((record) => isNonEmptyString(record.run_id ?? record.runId))?.run_id
      ?? records.find((record) => isNonEmptyString(record.runId))?.runId,
    cwd: records.find((record) => isNonEmptyString(record.cwd))?.cwd,
    started_at: records[0]?.timestamp,
    ended_at: records.at(-1)?.timestamp,
    steps: records,
  };

  return buildCodexSession(sessionDocument, sourcePath);
}
