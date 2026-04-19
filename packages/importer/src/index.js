import fs from 'node:fs/promises';
import path from 'node:path';

import {
  normalizeTraceSession,
  validateTraceSession,
} from '../../core/src/index.js';
import {
  importCodexSessionDocument,
  importCodexStepRecords,
  isCodexSessionDocument,
  isCodexStepRecordList,
} from './adapters/codex.js';

function buildSessionId(sourcePath) {
  const stem = path.basename(sourcePath).replace(/\.[^.]+$/, '');
  return `fixture-${stem}`;
}

function wrapEvents(events, sourcePath, format) {
  return {
    sessionId: buildSessionId(sourcePath),
    source: {
      format,
      origin: sourcePath,
      fixture: sourcePath.includes('fixtures'),
      notes: 'Wrapped from raw trace input by the importer.',
      ingestedAt: new Date().toISOString(),
    },
    metadata: {
      importedFrom: sourcePath,
      adapter: 'generic',
    },
    events,
  };
}

function parseNdjson(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid NDJSON at line ${index + 1}: ${error.message}`);
      }
    });
}

function parseJson(raw, sourcePath) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${sourcePath}: ${error.message}`);
  }
}

function resolveSessionFromRecords(records, sourcePath, format) {
  if (isCodexStepRecordList(records)) {
    return importCodexStepRecords(records, sourcePath);
  }

  return wrapEvents(records, sourcePath, format);
}

function resolveSessionFromJson(parsed, sourcePath) {
  if (isCodexSessionDocument(parsed)) {
    return importCodexSessionDocument(parsed, sourcePath);
  }

  if (Array.isArray(parsed)) {
    return resolveSessionFromRecords(parsed, sourcePath, 'json-array');
  }

  if (Array.isArray(parsed.events)) {
    return {
      ...parsed,
      source: {
        format: parsed.source?.format ?? 'json',
        origin: parsed.source?.origin ?? sourcePath,
        fixture: parsed.source?.fixture ?? sourcePath.includes('fixtures'),
        notes: parsed.source?.notes ?? 'Loaded from session JSON.',
        ingestedAt: parsed.source?.ingestedAt ?? new Date().toISOString(),
      },
      metadata: {
        importedFrom: sourcePath,
        adapter: parsed.metadata?.adapter ?? 'session-json',
        ...parsed.metadata,
      },
    };
  }

  return wrapEvents([parsed], sourcePath, 'json-object');
}

export async function importTraceSession(inputPath) {
  const sourcePath = path.resolve(inputPath);
  const raw = await fs.readFile(sourcePath, 'utf8');
  const extension = path.extname(sourcePath).toLowerCase();

  let session;

  if (extension === '.ndjson') {
    session = resolveSessionFromRecords(parseNdjson(raw), sourcePath, 'ndjson');
  } else {
    session = resolveSessionFromJson(parseJson(raw, sourcePath), sourcePath);
  }

  const normalized = normalizeTraceSession(session);
  const validation = validateTraceSession(normalized);
  if (!validation.ok) {
    throw new Error(`Trace session validation failed at ${validation.path}: ${validation.message}`);
  }

  return normalized;
}

export async function writeTraceSession(outputPath, session) {
  const targetPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  return targetPath;
}
