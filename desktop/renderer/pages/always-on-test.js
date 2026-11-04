// Settings → Always on (own accounts): the Test button row. Starts the engine's `test` run in the person's own GitHub repository and shows one tick per check while it runs
// (lib/always-on-test.js reads the run). One owner of the state here: `phase`, changed only by press, poll and setReady. Guard: test/unit/renderer/always-on-test-words.test.js (words); the page is checked in the demo.
import {el, pill, liveDot} from '../components.js';
import {$, show} from './core.js';
import {NAME, lead, pillFor, buttonFor, chipFor, summary, startFailed, advance} from '../always-on-test-words.js';

const POLL_MS = 3000;
// `turn` counts presses and resets: a read that was in flight when it changed belongs to an older test and is dropped (review of 3/3, 4 Nov 2026).
let way = 'own', phase = 'idle', since = 0, after = 0, runId = 0, turn = 0, startedAt = 0, timer = 0, missing = [], steps = [], url = '', message = '';

function drawSteps() {
  const list = $('aon-test-steps');
  list.replaceChildren(...steps.map(step => {
    const row = el('li', 'aon-check'), chip = chipFor(step.state);
    row.dataset.state = step.state;
    row.append(liveDot(step.state === 'running' ? 'live' : step.state === 'failed' ? 'warn' : 'done'), el('span', 'aon-check-title', step.title), pill(chip.text, chip.tone));
    if (step.line) row.append(el('p', 'muted small aon-check-line', step.line));
    return row;
  }));
  show(list, steps.length > 0);
}

function draw() {
  const ready = way === 'own' && missing.length === 0, button = buttonFor(phase), tone = pillFor(phase);
  $('aon-test-pill').replaceChildren(...(tone ? [pill(tone[0], tone[1], {dot: true})] : []));
  $('aon-test-line').textContent = lead(missing, way);
  const go = $('aon-test-go');
  go.textContent = button.text;
  go.disabled = !ready || button.busy;
  go.title = ready ? '' : lead(missing, way);
  show($('aon-test-open'), !!url);
  $('aon-test-result').textContent = message || summary(phase, steps);
  drawSteps();
}

async function poll() {
  clearTimeout(timer);
  const mine = turn;
  let read;
  try { read = await window.pilot.cloudTestRead(since, after, runId); } catch (error) { read = {found: false, steps: [], error: String(error?.message || error)}; }
  if (mine !== turn || (phase !== 'starting' && phase !== 'running')) return;   // a newer press or setReady already decided
  steps = read.steps?.length ? read.steps : steps;
  url = read.url || url;
  runId = read.runId || runId;
  const next = advance({phase, read, elapsedMs: Date.now() - startedAt});
  phase = next.phase; message = next.message;
  if (next.again) timer = setTimeout(poll, POLL_MS);
  draw();
}

async function press() {
  clearTimeout(timer);
  const mine = ++turn;
  phase = 'starting'; steps = []; url = ''; message = ''; runId = 0;
  draw();
  const started = await window.pilot.cloudTestStart();
  if (mine !== turn) return;
  if (!started?.ok) { phase = 'failed'; message = startFailed(started?.error); draw(); return; }
  since = started.since; after = started.after || 0; startedAt = Date.now();
  poll();
}

/** Called by the GitHub card whenever its three requirements change: `names` are the ones still to set up (empty = the test may run). */
export function setReady(names) {
  missing = names;
  if (names.length && (phase === 'starting' || phase === 'running')) { clearTimeout(timer); turn++; phase = 'idle'; steps = []; message = ''; }   // a key removed mid-test: the result is no longer about the setup
  if ($('aon-test-go')) draw();
}

// TODO(AI): the Test for our servers, when the hosted runner exists (4 Nov 2026, spec 2026-11-04-always-on-one-choice.md)
/** The way the choice card shows ('own' | 'ours'). Our servers have no test to run yet, so the row says so; the own way's result is kept while you look at the other. */
export function setWay(next) {
  way = next;
  if ($('aon-test-go')) draw();
}

/** Wire the row once (its markup is in index.html). */
export function bindTest() {
  const go = $('aon-test-go');
  if (!go || go.dataset.bound) return;
  go.dataset.bound = '1';
  go.addEventListener('click', press);
  $('aon-test-open').addEventListener('click', () => window.pilot.openExternal(url));
  $('aon-test-title').textContent = NAME;
  draw();
}
