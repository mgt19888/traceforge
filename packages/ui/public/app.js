const state = {
  selectedKind: 'all',
  payload: null,
};

const summaryRoot = document.querySelector('#summary-cards');
const filterRoot = document.querySelector('#filters');
const timelineRoot = document.querySelector('#timeline');
const metaRoot = document.querySelector('#session-meta');
const replayRoot = document.querySelector('#replay-strip');
const commandRoot = document.querySelector('#command-pane');
const testRoot = document.querySelector('#test-pane');
const diffRoot = document.querySelector('#diff-pane');
const issuesRoot = document.querySelector('#issues-pane');
const artifactRoot = document.querySelector('#artifact-pane');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDuration(durationMs) {
  if (typeof durationMs !== 'number') {
    return 'n/a';
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatStatus(status) {
  return status ? `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>` : '';
}

function renderSummary() {
  const { summary } = state.payload;
  const cards = [
    ['Events', summary.totalEvents],
    ['Commands', summary.commandCount],
    ['Tests', summary.testCount],
    ['Files', summary.filesTouched],
    ['Errors', summary.errorCount],
    ['Replay Span', formatDuration(summary.replaySpanMs)],
  ];

  summaryRoot.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="card">
          <p class="card-label">${escapeHtml(label)}</p>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `,
    )
    .join('');
}

function renderFilters() {
  const { counts } = state.payload.summary;
  const allCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const filters = [['all', allCount], ...Object.entries(counts)];

  filterRoot.innerHTML = filters
    .map(
      ([kind, count]) => `
        <button class="filter ${state.selectedKind === kind ? 'active' : ''}" data-kind="${escapeHtml(kind)}">
          ${escapeHtml(kind)} <span>${escapeHtml(count)}</span>
        </button>
      `,
    )
    .join('');

  for (const button of filterRoot.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      state.selectedKind = button.dataset.kind;
      renderFilters();
      renderTimeline();
    });
  }
}

function renderTimeline() {
  const events = state.payload.session.events.filter((event) => {
    return state.selectedKind === 'all' || event.kind === state.selectedKind;
  });

  timelineRoot.innerHTML = events
    .map(
      (event) => `
        <article class="event-card kind-${escapeHtml(event.kind)}">
          <div class="event-header">
            <span class="pill">${escapeHtml(event.kind)}</span>
            <div class="event-meta">
              ${formatStatus(event.data.status ?? event.data.severity ?? null)}
              <time>${escapeHtml(event.timestamp)}</time>
            </div>
          </div>
          <h3>${escapeHtml(event.summary)}</h3>
          <p class="muted">Actor: ${escapeHtml(event.actor)}</p>
          <pre>${escapeHtml(JSON.stringify(event.data, null, 2))}</pre>
        </article>
      `,
    )
    .join('');

  if (events.length === 0) {
    timelineRoot.innerHTML = '<p class="muted">No events match this filter.</p>';
  }
}

function renderReplay() {
  const { replay } = state.payload.observability;

  replayRoot.innerHTML = replay.frames
    .map(
      (frame) => `
        <article class="mini-card ${frame.emphasis ? 'emphasis' : ''}">
          <div class="event-header">
            <span class="pill">#${escapeHtml(frame.sequence)}</span>
            <div class="event-meta">
              ${formatStatus(frame.status)}
              <span class="muted">+${escapeHtml(formatDuration(frame.offsetMs))}</span>
            </div>
          </div>
          <strong>${escapeHtml(frame.summary)}</strong>
          <p class="muted">${escapeHtml(frame.kind)} · ${escapeHtml(frame.actor)}${frame.gapMs ? ` · gap ${escapeHtml(formatDuration(frame.gapMs))}` : ''}</p>
          ${frame.promptExcerpt ? `<p>${escapeHtml(frame.promptExcerpt)}</p>` : ''}
        </article>
      `,
    )
    .join('');
}

function renderCommands() {
  const commands = state.payload.observability.commands;

  if (commands.length === 0) {
    commandRoot.innerHTML = '<p class="muted">No command runs captured.</p>';
    return;
  }

  commandRoot.innerHTML = commands
    .map(
      (command) => `
        <article class="mini-card">
          <div class="event-header">
            <strong>${escapeHtml(command.command)}</strong>
            ${formatStatus(command.status)}
          </div>
          <p class="muted">${escapeHtml(command.timestamp)}${command.cwd ? ` · ${escapeHtml(command.cwd)}` : ''}</p>
          <p class="muted">Exit ${escapeHtml(command.exitCode ?? 'n/a')} · ${escapeHtml(formatDuration(command.durationMs))}</p>
          ${command.stdoutSnippet ? `<pre>${escapeHtml(command.stdoutSnippet)}</pre>` : ''}
          ${command.stdoutRef ? `<p class="muted">stdout: ${escapeHtml(command.stdoutRef)}</p>` : ''}
          ${command.stderrRef ? `<p class="muted">stderr: ${escapeHtml(command.stderrRef)}</p>` : ''}
        </article>
      `,
    )
    .join('');
}

function renderTests() {
  const tests = state.payload.observability.tests;

  if (tests.length === 0) {
    testRoot.innerHTML = '<p class="muted">No test runs captured.</p>';
    return;
  }

  testRoot.innerHTML = tests
    .map(
      (test) => `
        <article class="mini-card">
          <div class="event-header">
            <strong>${escapeHtml(test.command)}</strong>
            ${formatStatus(test.status)}
          </div>
          <p class="muted">${escapeHtml(test.timestamp)}${test.suite ? ` · ${escapeHtml(test.suite)}` : ''}</p>
          <p class="muted">Passed ${escapeHtml(test.passed ?? 0)} · Failed ${escapeHtml(test.failed ?? 0)} · ${escapeHtml(formatDuration(test.durationMs))}</p>
          ${test.outputRef ? `<p class="muted">output: ${escapeHtml(test.outputRef)}</p>` : ''}
        </article>
      `,
    )
    .join('');
}

function renderDiffs() {
  const diffs = state.payload.observability.diffs;

  if (diffs.length === 0) {
    diffRoot.innerHTML = '<p class="muted">No diff activity captured.</p>';
    return;
  }

  diffRoot.innerHTML = diffs
    .map((diff) => {
      const stats = [];
      if (typeof diff.linesAdded === 'number') {
        stats.push(`+${diff.linesAdded}`);
      }
      if (typeof diff.linesRemoved === 'number') {
        stats.push(`-${diff.linesRemoved}`);
      }

      return `
        <article class="mini-card">
          <div class="event-header">
            <strong>${escapeHtml(diff.kind === 'patch' ? diff.diffSummary : diff.path)}</strong>
            <span class="pill">${escapeHtml(diff.kind)}</span>
          </div>
          <p class="muted">${escapeHtml(diff.timestamp)}</p>
          ${diff.kind === 'patch'
            ? `<p class="muted">${escapeHtml(diff.target)} · ${escapeHtml(diff.format)}${diff.hunks ? ` · ${escapeHtml(diff.hunks)} hunks` : ''}</p>`
            : `<p class="muted">${escapeHtml(diff.changeType)}</p>`}
          ${stats.length ? `<p class="muted">${escapeHtml(stats.join(' '))}</p>` : ''}
          ${diff.files?.length ? `<p>${escapeHtml(diff.files.join(', '))}</p>` : ''}
          ${diff.diffRef ? `<p class="muted">diff: ${escapeHtml(diff.diffRef)}</p>` : ''}
        </article>
      `;
    })
    .join('');
}

function renderIssuesAndArtifacts() {
  const { issues, artifactRefs } = state.payload.observability;

  issuesRoot.innerHTML = issues.length
    ? issues
        .map(
          (issue) => `
            <article class="mini-card issue">
              <div class="event-header">
                <strong>${escapeHtml(issue.summary)}</strong>
                ${formatStatus(issue.severity)}
              </div>
              <p class="muted">${escapeHtml(issue.timestamp)} · ${escapeHtml(issue.category)}</p>
              ${issue.source ? `<p>${escapeHtml(issue.source)}</p>` : ''}
            </article>
          `,
        )
        .join('')
    : '<p class="muted">No warnings or failures captured.</p>';

  artifactRoot.innerHTML = artifactRefs.length
    ? artifactRefs.map((ref) => `<span class="artifact-chip">${escapeHtml(ref)}</span>`).join('')
    : '<p class="muted">No artifact references recorded.</p>';
}

async function bootstrap() {
  const response = await fetch('/api/session');
  const payload = await response.json();
  state.payload = payload;

  const adapter = payload.session.metadata?.adapter ? ` · adapter ${payload.session.metadata.adapter}` : '';
  const format = payload.session.source?.format ? ` · ${payload.session.source.format}` : '';
  metaRoot.textContent = `${payload.session.sessionId}${adapter}${format} · ${payload.sourcePath}`;
  renderSummary();
  renderFilters();
  renderReplay();
  renderTimeline();
  renderCommands();
  renderTests();
  renderDiffs();
  renderIssuesAndArtifacts();
}

bootstrap().catch((error) => {
  metaRoot.textContent = `Failed to load session: ${error.message}`;
});
