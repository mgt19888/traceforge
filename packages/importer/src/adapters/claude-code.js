import path from 'node:path';

const CLAUDE_CODE_SESSION_FORMAT = 'claude-code-session';
const KNOWN_CLAUDE_ROLES = new Set(['user', 'assistant', 'system']);
const KNOWN_CLAUDE_ENTRY_TYPES = new Set([
  'message',
  'user_message',
  'assistant_message',
  'system_message',
  'command',
  'file_edit',
  'apply_patch',
  'patch',
  'test_result',
  'error',
  'outcome',
  'tool_use',
  'tool_result',
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
  return `claude-${stem}`;
}

function buildTags(baseTags, rawType) {
  const tags = new Set(['adapter:claude-code']);

  for (const tag of asArray(baseTags)) {
    if (isNonEmptyString(tag)) {
      tags.add(tag.trim());
    }
  }

  if (isNonEmptyString(rawType)) {
    tags.add(`claude-code:${rawType}`);
  }

  return [...tags];
}

function mapToolStatus(status, isError = false) {
  if (isError) {
    return 'failed';
  }

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

function mapCommandStatus(status, isError = false) {
  if (isError) {
    return 'failed';
  }

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

function mapTestStatus(status, isError = false) {
  if (isError) {
    return 'failed';
  }

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

function mapChangeType(changeType, fallback = 'update') {
  switch (changeType) {
    case 'create':
    case 'update':
    case 'delete':
    case 'rename':
      return changeType;
    default:
      return fallback;
  }
}

function getSessionEntries(document) {
  for (const key of ['transcript', 'messages', 'entries']) {
    if (Array.isArray(document?.[key])) {
      return document[key];
    }
  }

  return [];
}

function hasClaudeBlock(value) {
  return asArray(value).some((block) => {
    return isObject(block) && ['text', 'tool_use', 'tool_result'].includes(block.type);
  });
}

function isClaudeEntryLike(entry) {
  if (!isObject(entry)) {
    return false;
  }

  return KNOWN_CLAUDE_ROLES.has(entry.role)
    || KNOWN_CLAUDE_ENTRY_TYPES.has(entry.type)
    || hasClaudeBlock(entry.content)
    || hasClaudeBlock(entry.message?.content);
}

function extractTextParts(value) {
  if (isNonEmptyString(value)) {
    return [value.trim()];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextParts(entry));
  }

  if (isObject(value)) {
    if (value.type === 'text' && isNonEmptyString(value.text)) {
      return [value.text.trim()];
    }

    if (isNonEmptyString(value.content)) {
      return [value.content.trim()];
    }

    return [
      ...extractTextParts(value.text),
      ...extractTextParts(value.content),
      ...extractTextParts(value.stdout),
      ...extractTextParts(value.stderr),
      ...extractTextParts(value.result),
      ...extractTextParts(value.output),
      ...extractTextParts(value.summary),
      ...extractTextParts(value.message),
    ];
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }

  return [];
}

function extractText(value) {
  return extractTextParts(value)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function summarizeValue(value, fallback) {
  const text = extractText(value);
  if (isNonEmptyString(text)) {
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  }

  if (value === undefined || value === null) {
    return fallback;
  }

  try {
    const serialized = JSON.stringify(value);
    if (isNonEmptyString(serialized)) {
      return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function getNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function getString(...values) {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value.trim();
    }
  }

  return undefined;
}

function getPathList(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const paths = value
        .map((entry) => {
          if (isNonEmptyString(entry)) {
            return entry.trim();
          }
          if (isObject(entry) && isNonEmptyString(entry.path)) {
            return entry.path.trim();
          }
          return null;
        })
        .filter(Boolean);

      if (paths.length > 0) {
        return paths;
      }
    }
  }

  return [];
}

function normalizeRole(entry) {
  if (KNOWN_CLAUDE_ROLES.has(entry?.role)) {
    return entry.role;
  }

  switch (entry?.type) {
    case 'user_message':
      return 'user';
    case 'assistant_message':
      return 'assistant';
    case 'system_message':
      return 'system';
    default:
      return null;
  }
}

function getContentBlocks(entry) {
  const content = entry?.content ?? entry?.message?.content;

  if (Array.isArray(content)) {
    return content.filter((block) => isObject(block));
  }

  if (isObject(content)) {
    return [content];
  }

  return [];
}

function buildPromptEvent(entry, role, timestamp, fallbackSummary) {
  const text = extractText(entry.content ?? entry.message?.content);
  if (!isNonEmptyString(text)) {
    return null;
  }

  return {
    timestamp,
    kind: 'prompt',
    actor: role,
    summary: entry.summary ?? fallbackSummary,
    tags: buildTags(entry.tags, entry.type ?? role),
    data: {
      role,
      content: text,
      channel: entry.channel ?? 'chat',
      rawEntryType: entry.type ?? role,
    },
  }; 
}

function buildPendingId(index, blockIndex) {
  return `claude-tool-${index + 1}-${blockIndex + 1}`;
}

function isShellTool(pending) {
  const name = pending.name.toLowerCase();
  return name.includes('bash')
    || name.includes('shell')
    || name.includes('terminal')
    || name.includes('command')
    || isNonEmptyString(pending.input.command)
    || isNonEmptyString(pending.input.cmd);
}

function isPatchTool(pending) {
  const name = pending.name.toLowerCase();
  return name.includes('patch')
    || name.includes('diff')
    || isNonEmptyString(pending.input.patch)
    || isNonEmptyString(pending.input.diff)
    || Array.isArray(pending.input.files);
}

function isFileEditTool(pending) {
  const name = pending.name.toLowerCase();
  return name.includes('write')
    || name.includes('edit')
    || name.includes('rename')
    || name.includes('delete')
    || name.includes('move')
    || isNonEmptyString(pending.input.path);
}

function isTestCommand(command, result) {
  if (typeof result?.passed === 'number' || typeof result?.failed === 'number' || isNonEmptyString(result?.suite)) {
    return true;
  }

  return /(^|\s)(npm|pnpm|yarn|bun|cargo|go|pytest|python|node)\b.*\b(test|jest|vitest|pytest|node --test)\b/i.test(command);
}

function normalizeToolResult(block) {
  const payload = [block.result, block.output, block.content]
    .find((candidate) => isObject(candidate)) ?? {};

  return {
    status: getString(block.status, payload.status),
    isError: Boolean(block.is_error ?? block.isError ?? payload.is_error ?? payload.isError),
    exitCode: getNumber(block.exit_code, block.exitCode, payload.exit_code, payload.exitCode),
    durationMs: getNumber(block.duration_ms, block.durationMs, payload.duration_ms, payload.durationMs),
    suite: getString(block.suite, payload.suite),
    stdoutSnippet: getString(block.stdout, payload.stdout, payload.stdout_snippet, payload.stdoutSnippet),
    stderrSnippet: getString(block.stderr, payload.stderr, payload.stderr_snippet, payload.stderrSnippet),
    outputRef: getString(block.output_ref, block.outputRef, payload.output_ref, payload.outputRef),
    diffRef: getString(block.diff_ref, block.diffRef, payload.diff_ref, payload.diffRef),
    summary: getString(block.summary, payload.summary),
    message: getString(block.message, payload.message),
    path: getString(block.path, payload.path),
    changeType: getString(block.change_type, block.changeType, payload.change_type, payload.changeType),
    format: getString(block.format, payload.format),
    target: getString(block.target, payload.target),
    text: extractText(block.content ?? block.output ?? block.result),
    files: getPathList(block.files, payload.files),
    hunks: getNumber(block.hunks, payload.hunks),
    linesAdded: getNumber(block.lines_added, block.linesAdded, payload.lines_added, payload.linesAdded),
    linesRemoved: getNumber(block.lines_removed, block.linesRemoved, payload.lines_removed, payload.linesRemoved),
    passed: getNumber(block.passed, payload.passed),
    failed: getNumber(block.failed, payload.failed),
    artifactRefs: getPathList(block.artifact_refs, block.artifactRefs, payload.artifact_refs, payload.artifactRefs),
  };
}

function buildToolEventFromPending(pending, result, timestamp) {
  const command = getString(pending.input.command, pending.input.cmd);

  if (isShellTool(pending) && isNonEmptyString(command)) {
    if (isTestCommand(command, result)) {
      return {
        timestamp,
        kind: 'test',
        actor: pending.actor,
        summary: pending.summary ?? `Validate ${command}`,
        tags: buildTags(pending.tags, pending.rawType ?? pending.name),
        data: {
          command,
          status: mapTestStatus(result.status, result.isError),
          passed: result.passed ?? 0,
          failed: result.failed ?? (result.isError ? 1 : 0),
          durationMs: result.durationMs,
          suite: result.suite ?? pending.input.suite,
          outputRef: result.outputRef,
          rawEntryType: pending.rawType ?? pending.name,
        },
      };
    }

    return {
      timestamp,
      kind: 'command',
      actor: pending.actor,
      summary: pending.summary ?? `Run ${command}`,
      tags: buildTags(pending.tags, pending.rawType ?? pending.name),
      data: {
        command,
        cwd: getString(pending.input.cwd, pending.cwd),
        status: mapCommandStatus(result.status, result.isError),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdoutSnippet: result.stdoutSnippet ?? result.text,
        stderrSnippet: result.stderrSnippet,
        stdoutRef: result.outputRef,
        stderrRef: undefined,
        rawEntryType: pending.rawType ?? pending.name,
      },
    };
  }

  if (isPatchTool(pending)) {
    const files = getPathList(pending.input.files, result.files);
    return {
      timestamp,
      kind: 'patch',
      actor: pending.actor,
      summary: pending.summary ?? 'Apply Claude Code patch',
      tags: buildTags(pending.tags, pending.rawType ?? pending.name),
      data: {
        target: result.target ?? pending.input.target ?? pending.input.path ?? 'workspace',
        format: result.format ?? pending.input.format ?? 'unified',
        diffSummary: result.summary ?? result.message ?? result.text ?? pending.input.summary ?? 'Patch applied through Claude Code.',
        hunks: result.hunks,
        linesAdded: result.linesAdded,
        linesRemoved: result.linesRemoved,
        files,
        diffRef: result.diffRef,
        rawEntryType: pending.rawType ?? pending.name,
      },
    };
  }

  if (isFileEditTool(pending)) {
    const name = pending.name.toLowerCase();
    const fallbackChangeType = name.includes('rename')
      ? 'rename'
      : name.includes('delete')
        ? 'delete'
        : 'update';

    return {
      timestamp,
      kind: 'file_edit',
      actor: pending.actor,
      summary: pending.summary ?? `Update ${pending.input.path ?? result.path ?? 'file'}`,
      tags: buildTags(pending.tags, pending.rawType ?? pending.name),
      data: {
        path: result.path ?? pending.input.path ?? 'unknown',
        changeType: mapChangeType(result.changeType ?? pending.input.change_type ?? pending.input.changeType, fallbackChangeType),
        language: getString(pending.input.language, result.language),
        linesAdded: result.linesAdded ?? getNumber(pending.input.lines_added, pending.input.linesAdded),
        linesRemoved: result.linesRemoved ?? getNumber(pending.input.lines_removed, pending.input.linesRemoved),
        rawEntryType: pending.rawType ?? pending.name,
      },
    };
  }

  return {
    timestamp,
    kind: 'tool',
    actor: pending.actor,
    summary: pending.summary ?? `Use ${pending.name}`,
    tags: buildTags(pending.tags, pending.rawType ?? pending.name),
    data: {
      toolName: pending.name,
      status: mapToolStatus(result.status, result.isError),
      inputSummary: summarizeValue(pending.input, 'No tool input captured.'),
      outputSummary: result.summary ?? result.message ?? result.text ?? 'Tool completed.',
      callId: pending.id,
      rawEntryType: pending.rawType ?? pending.name,
    },
  };
}

function buildRequestedToolEvent(pending) {
  const command = getString(pending.input.command, pending.input.cmd);

  if (isShellTool(pending) && isNonEmptyString(command)) {
    return {
      timestamp: pending.timestamp,
      kind: 'command',
      actor: pending.actor,
      summary: pending.summary ?? `Run ${command}`,
      tags: buildTags(pending.tags, pending.rawType ?? pending.name),
      data: {
        command,
        cwd: getString(pending.input.cwd, pending.cwd),
        status: 'planned',
        rawEntryType: pending.rawType ?? pending.name,
      },
    };
  }

  return {
    timestamp: pending.timestamp,
    kind: 'tool',
    actor: pending.actor,
    summary: pending.summary ?? `Use ${pending.name}`,
    tags: buildTags(pending.tags, pending.rawType ?? pending.name),
    data: {
      toolName: pending.name,
      status: 'requested',
      inputSummary: summarizeValue(pending.input, 'No tool input captured.'),
      outputSummary: 'Tool request captured without a matching result.',
      callId: pending.id,
      rawEntryType: pending.rawType ?? pending.name,
    },
  };
}

function mapExplicitEntry(entry, timestamp) {
  switch (entry.type) {
    case 'command':
      return [{
        timestamp,
        kind: 'command',
        actor: entry.actor ?? 'assistant',
        summary: entry.summary ?? `Run ${entry.command ?? 'shell command'}`,
        tags: buildTags(entry.tags, entry.type),
        data: {
          command: entry.command ?? 'unknown command',
          cwd: entry.cwd,
          status: mapCommandStatus(entry.status, false),
          exitCode: getNumber(entry.exit_code, entry.exitCode),
          durationMs: getNumber(entry.duration_ms, entry.durationMs),
          stdoutSnippet: entry.stdout_snippet ?? entry.stdoutSnippet,
          stderrSnippet: entry.stderr_snippet ?? entry.stderrSnippet,
          stdoutRef: entry.stdout_ref ?? entry.stdoutRef,
          stderrRef: entry.stderr_ref ?? entry.stderrRef,
          rawEntryType: entry.type,
        },
      }];
    case 'file_edit':
      return [{
        timestamp,
        kind: 'file_edit',
        actor: entry.actor ?? 'assistant',
        summary: entry.summary ?? `Update ${entry.path ?? 'file'}`,
        tags: buildTags(entry.tags, entry.type),
        data: {
          path: entry.path ?? 'unknown',
          changeType: mapChangeType(entry.change_type ?? entry.changeType),
          language: entry.language,
          linesAdded: getNumber(entry.lines_added, entry.linesAdded),
          linesRemoved: getNumber(entry.lines_removed, entry.linesRemoved),
          rawEntryType: entry.type,
        },
      }];
    case 'apply_patch':
    case 'patch':
      return [{
        timestamp,
        kind: 'patch',
        actor: entry.actor ?? 'assistant',
        summary: entry.summary ?? 'Apply Claude Code patch',
        tags: buildTags(entry.tags, entry.type),
        data: {
          target: entry.target ?? 'workspace',
          format: entry.format ?? 'unified',
          diffSummary: entry.diff_summary ?? entry.diffSummary ?? entry.summary ?? 'Patch applied.',
          hunks: getNumber(entry.hunks),
          linesAdded: getNumber(entry.lines_added, entry.linesAdded),
          linesRemoved: getNumber(entry.lines_removed, entry.linesRemoved),
          files: getPathList(entry.files),
          diffRef: entry.diff_ref ?? entry.diffRef,
          rawEntryType: entry.type,
        },
      }];
    case 'test_result':
      return [{
        timestamp,
        kind: 'test',
        actor: entry.actor ?? 'assistant',
        summary: entry.summary ?? `Validate ${entry.command ?? 'test command'}`,
        tags: buildTags(entry.tags, entry.type),
        data: {
          command: entry.command ?? 'unknown test command',
          status: mapTestStatus(entry.status, false),
          passed: getNumber(entry.passed) ?? 0,
          failed: getNumber(entry.failed) ?? 0,
          durationMs: getNumber(entry.duration_ms, entry.durationMs),
          suite: entry.suite,
          outputRef: entry.output_ref ?? entry.outputRef,
          rawEntryType: entry.type,
        },
      }];
    case 'error':
      return [{
        timestamp,
        kind: 'error',
        actor: entry.actor ?? 'system',
        summary: entry.summary ?? 'Claude Code session error',
        tags: buildTags(entry.tags, entry.type),
        data: {
          message: entry.message ?? 'Unknown error',
          severity: mapSeverity(entry.severity),
          source: entry.source ?? 'claude-code-adapter',
          rawEntryType: entry.type,
        },
      }];
    case 'outcome':
      return [{
        timestamp,
        kind: 'outcome',
        actor: entry.actor ?? 'assistant',
        summary: entry.summary ?? 'Claude Code session outcome',
        tags: buildTags(entry.tags, entry.type),
        data: {
          status: mapOutcomeStatus(entry.status),
          summary: entry.result_summary ?? entry.resultSummary ?? entry.summary ?? 'Outcome recorded',
          artifactRefs: getPathList(entry.artifact_refs, entry.artifactRefs),
          rawEntryType: entry.type,
        },
      }];
    default:
      return [];
  }
}

function buildClaudeEvents(entries, document, startedAt) {
  const pendingTools = new Map();
  const events = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const timestamp = normalizeTimestamp(
      entry.timestamp ?? entry.created_at ?? entry.createdAt,
      new Date(Date.parse(startedAt) + index * 5000).toISOString(),
    );

    const role = normalizeRole(entry);
    if (role) {
      const prompt = buildPromptEvent(entry, role, timestamp, `Claude ${role} message`);
      if (prompt) {
        events.push(prompt);
      }
    }

    const explicitEvents = mapExplicitEntry(entry, timestamp);
    if (explicitEvents.length > 0) {
      events.push(...explicitEvents);
      continue;
    }

    const blocks = getContentBlocks(entry);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex];

      if (block.type === 'tool_use') {
        const id = block.id ?? buildPendingId(index, blockIndex);
        pendingTools.set(id, {
          id,
          timestamp,
          actor: entry.actor ?? role ?? 'assistant',
          name: getString(block.name, block.tool_name, block.toolName) ?? 'tool',
          input: isObject(block.input) ? block.input : {},
          cwd: document.cwd,
          summary: entry.summary,
          tags: entry.tags,
          rawType: block.type,
        });
        continue;
      }

      if (block.type === 'tool_result') {
        const id = getString(block.tool_use_id, block.toolUseId);
        const pending = pendingTools.get(id);
        const result = normalizeToolResult(block);

        if (pending) {
          pendingTools.delete(id);
          events.push(buildToolEventFromPending(pending, result, timestamp));
          continue;
        }

        events.push({
          timestamp,
          kind: 'tool',
          actor: entry.actor ?? role ?? 'assistant',
          summary: entry.summary ?? 'Claude Code tool result',
          tags: buildTags(entry.tags, block.type),
          data: {
            toolName: 'unknown-tool',
            status: mapToolStatus(result.status, result.isError),
            inputSummary: 'No matching tool request was found.',
            outputSummary: result.summary ?? result.message ?? result.text ?? 'Tool result recorded.',
            callId: id,
            rawEntryType: block.type,
          },
        });
      }
    }
  }

  for (const pending of pendingTools.values()) {
    events.push(buildRequestedToolEvent(pending));
  }

  return events;
}

function buildClaudeSession(document, sourcePath) {
  const fallbackStart = new Date(Date.UTC(2026, 3, 20, 2, 5, 0)).toISOString();
  const sessionId = document.session_id ?? document.sessionId ?? buildSessionId(sourcePath);
  const startedAt = normalizeTimestamp(document.started_at ?? document.startedAt, fallbackStart);
  const entries = getSessionEntries(document);

  return {
    sessionId,
    source: {
      format: CLAUDE_CODE_SESSION_FORMAT,
      origin: sourcePath,
      fixture: sourcePath.includes('fixtures'),
      notes: 'Imported through the Claude Code session adapter.',
      ingestedAt: new Date().toISOString(),
    },
    metadata: {
      importedFrom: sourcePath,
      adapter: 'claude-code',
      provider: document.provider ?? 'anthropic',
      model: document.model ?? null,
      runId: document.run_id ?? document.runId ?? null,
      cwd: document.cwd ?? null,
      startedAt,
      endedAt: normalizeTimestamp(document.ended_at ?? document.endedAt, startedAt),
      tags: asArray(document.tags).filter(isNonEmptyString),
    },
    events: buildClaudeEvents(entries, document, startedAt),
  };
}

export function isClaudeCodeSessionDocument(value) {
  const entries = getSessionEntries(value);
  return isObject(value)
    && entries.length > 0
    && (
      value.format === CLAUDE_CODE_SESSION_FORMAT
      || value.source_app === 'claude-code'
      || value.sourceApp === 'claude-code'
      || value.app === 'claude-code'
      || value.client === 'claude-code'
      || ((value.provider === 'anthropic' || value.provider === 'claude') && entries.some(isClaudeEntryLike))
      || entries.some((entry) => KNOWN_CLAUDE_ROLES.has(entry.role) || hasClaudeBlock(entry.content) || hasClaudeBlock(entry.message?.content))
    );
}

export function isClaudeCodeRecordList(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => isObject(entry) && !('kind' in entry))
    && value.some(isClaudeEntryLike);
}

export function importClaudeCodeSessionDocument(document, sourcePath) {
  return buildClaudeSession(document, sourcePath);
}

export function importClaudeCodeEntryRecords(records, sourcePath) {
  return buildClaudeSession({
    format: CLAUDE_CODE_SESSION_FORMAT,
    source_app: 'claude-code',
    provider: 'anthropic',
    session_id: records.find((record) => isNonEmptyString(record.session_id ?? record.sessionId))?.session_id
      ?? records.find((record) => isNonEmptyString(record.sessionId))?.sessionId,
    run_id: records.find((record) => isNonEmptyString(record.run_id ?? record.runId))?.run_id
      ?? records.find((record) => isNonEmptyString(record.runId))?.runId,
    cwd: records.find((record) => isNonEmptyString(record.cwd))?.cwd,
    started_at: records[0]?.timestamp,
    ended_at: records.at(-1)?.timestamp,
    transcript: records,
  }, sourcePath);
}
