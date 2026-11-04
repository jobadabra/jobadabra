// Settings → Always on (own accounts): the Test button row. Starts the engine's `test` run in the person's own GitHub repository and shows one tick per check while it runs
// (lib/always-on-test.js reads the run). One owner of the state here: `phase`, changed only by press, poll and setReady. Guard: test/unit/renderer/always-on-test-words.test.js (words); the page is checked in the demo.
import {el, pill, liveDot} from '../components.js';
import {$, show} from './core.js';
import {NAME, lead, pillFor, buttonFor, chipFor, summary, startFailed, NEVER_LISTED} from '../always-on-test-words.js';

const POLL_MS = 3000;
const GIVE_UP_MS = 6 * 60 * 1000;   // Why (4 Nov 2026): a test run lasts about a minute; six minutes of "running" is a stuck runner, and the row then says so instead of spinning for ever
let way = 'own', phase = 'idle', since = 0, startedAt = 0, timer = 0, missing = [], steps = [], url = '', message = '';

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
  let read;
  try { read = await window.pilot.cloudTestRead(since); } catch (error) { read = {found: false, verdict: 'running', steps: [], url: '', error: String(error?.message || error)}; }
  if (phase !== 'starting' && phase !== 'running') return;   // a newer press or setReady already decided
  steps = read.steps?.length ? read.steps : steps;
  url = read.url || url;
  if (read.found) { phase = read.verdict; message = ''; }
  else if (Date.now() - startedAt > GIVE_UP_MS / 6) message = NEVER_LISTED;   // GitHub lists a dispatched run within seconds
  if (phase === 'running' && Date.now() - startedAt > GIVE_UP_MS) { phase = 'failed'; message = 'The test is taking far longer than it should. Open the run to see where it waits.'; }
  if (phase === 'starting' || phase === 'running') timer = setTimeout(poll, POLL_MS);
  draw();
}

async function press() {
  clearTimeout(timer);
  phase = 'starting'; steps = []; url = ''; message = '';
  draw();
  const started = await window.pilot.cloudTestStart();
  if (!started?.ok) { phase = 'failed'; message = startFailed(started?.error); draw(); return; }
  since = started.since; startedAt = Date.now();
  poll();
}

/** Called by the GitHub card whenever its three requirements change: `names` are the ones still to set up (empty = the test may run). */
export function setReady(names) {
  missing = names;
  if (names.length && (phase === 'starting' || phase === 'running')) { clearTimeout(timer); phase = 'idle'; steps = []; }   // a key removed mid-test: the result is no longer about the setup
  if ($('aon-test-go')) draw();
}

/** The way the choice card shows ('own' | 'ours'). Our servers have no test to run yet (TODO(AI): their test, when the hosted runner exists, 4 Nov 2026), so the row says so; the own way's result is kept while you look at the other. */
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
