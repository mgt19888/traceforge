#!/usr/bin/env node

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildTraceObservability,
  summarizeTraceSession,
} from '../../core/src/index.js';
import { importTraceSession, writeTraceSession } from '../../importer/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../..');
const uiRoot = path.resolve(__dirname, '../../ui/public');
const defaultTracePath = path.resolve(workspaceRoot, 'artifacts/latest-session.json');
const defaultFixturePath = path.resolve(workspaceRoot, 'fixtures/codex-session.json');

function printHelp() {
  console.log(`TraceForge commands:

  ingest <input> [output]        Normalize a trace fixture into session JSON.
  serve [--trace PATH] [--port N] Serve the local TraceForge Web UI.
  help                           Show this message.
`);
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return fallback;
  }
  return args[index + 1];
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadSessionFromPreferredPath(tracePath) {
  const preferredPath = tracePath ? path.resolve(tracePath) : defaultTracePath;
  const sourcePath = (await fileExists(preferredPath)) ? preferredPath : defaultFixturePath;
  return {
    sourcePath,
    session: await importTraceSession(sourcePath),
  };
}

function buildSessionPayload(sourcePath, session) {
  return {
    sourcePath,
    summary: summarizeTraceSession(session),
    observability: buildTraceObservability(session),
    session,
  };
}

async function runIngest(args) {
  const inputPath = args[0] ? path.resolve(args[0]) : defaultFixturePath;
  const outputPath = args[1] ? path.resolve(args[1]) : defaultTracePath;
  const session = await importTraceSession(inputPath);
  await writeTraceSession(outputPath, session);
  const summary = summarizeTraceSession(session);

  console.log(`Ingested ${summary.totalEvents} events from ${inputPath}`);
  console.log(`Wrote normalized session JSON to ${outputPath}`);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  return 'text/html; charset=utf-8';
}

async function serveStaticAsset(requestPath, response) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const resolvedPath = path.normalize(path.join(uiRoot, safePath));

  if (!resolvedPath.startsWith(uiRoot)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const body = await fs.readFile(resolvedPath);
    response.writeHead(200, { 'content-type': contentTypeFor(resolvedPath) });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

async function writeJsonResponse(response, payload) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runServe(args) {
  const tracePath = readOption(args, '--trace', defaultTracePath);
  const port = Number.parseInt(readOption(args, '--port', '4310'), 10);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (url.pathname === '/api/session' || url.pathname === '/api/observability') {
      try {
        const { sourcePath, session } = await loadSessionFromPreferredPath(tracePath);
        const payload = buildSessionPayload(sourcePath, session);

        if (url.pathname === '/api/observability') {
          await writeJsonResponse(response, {
            sourcePath: payload.sourcePath,
            summary: payload.summary,
            observability: payload.observability,
          });
          return;
        }

        await writeJsonResponse(response, payload);
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        response.end(`${JSON.stringify({ error: error.message }, null, 2)}\n`);
      }
      return;
    }

    await serveStaticAsset(url.pathname, response);
  });

  server.listen(port, '127.0.0.1', async () => {
    const { sourcePath, session } = await loadSessionFromPreferredPath(tracePath);
    const summary = summarizeTraceSession(session);
    console.log(`TraceForge UI listening on http://127.0.0.1:${port}`);
    console.log(`Serving ${summary.totalEvents} events from ${sourcePath}`);
  });
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'ingest':
      await runIngest(args);
      break;
    case 'serve':
      await runServe(args);
      break;
    case 'help':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
