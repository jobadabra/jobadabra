// Settings → Always on: the Test button row, for both ways. Own accounts: the engine's `test` run in the person's own GitHub repository (lib/always-on-test.js reads it). Our servers: one real run on the site
// (lib/hosted-search.js testStart/testRead). One owner of each way's state: its `phase`, changed only by press, poll and setReady. Guard: test/unit/renderer/always-on-test-words.test.js (words); the page is checked in the demo.
import {el, pill, liveDot} from '../components.js';
import {$, show} from './core.js';
import {NAME, lead, pillFor, buttonFor, chipFor, summary, startFailed, advance} from '../always-on-test-words.js';

const POLL_MS = 3000;
// Why (5 Nov 2026, hr 5/6): each way keeps its own state, so a test running on our servers is not cut by a look at the own-accounts card, and each shows its own last result.
// `turn` counts presses and resets: a read that was in flight when it changed belongs to an older test and is dropped (review of 3/3, 4 Nov 2026).
const fresh = () => ({phase: 'idle', since: 0, after: 0, runId: 0, turn: 0, startedAt: 0, timer: 0, steps: [], url: '', message: ''});
const states = {own: fresh(), ours: fresh()};
let way = 'own', missing = [];
const now = () => states[way];

function drawSteps() {
  const list = $('aon-test-steps');
  list.replaceChildren(...now().steps.map(step => {
    const row = el('li', 'aon-check'), chip = chipFor(step.state);
    row.dataset.state = step.state;
    row.append(liveDot(step.state === 'running' ? 'live' : step.state === 'failed' ? 'warn' : 'done'), el('span', 'aon-check-title', step.title), pill(chip.text, chip.tone));
    if (step.line) row.append(el('p', 'muted small aon-check-line', step.line));
    return row;
  }));
  show(list, now().steps.length > 0);
}

function draw() {
  const {phase, steps, url, message} = now(), ready = way === 'ours' || missing.length === 0, button = buttonFor(phase), tone = pillFor(phase);
  $('aon-test-pill').replaceChildren(...(tone ? [pill(tone[0], tone[1], {dot: true})] : []));
  $('aon-test-line').textContent = lead(missing, way);
  const go = $('aon-test-go');
  go.textContent = button.text;
  go.disabled = !ready || button.busy;
  go.title = ready ? '' : lead(missing, way);
  show($('aon-test-open'), !!url);
  $('aon-test-result').textContent = message || summary(phase, steps, way);
  drawSteps();
}

async function poll(w) {
  const st = states[w];
  clearTimeout(st.timer);
  const mine = st.turn;
  let read;
  try { read = w === 'ours' ? await window.pilot.hostedTestRead(st.runId, st.since) : await window.pilot.cloudTestRead(st.since, st.after, st.runId); } catch (error) { read = {found: false, steps: [], error: String(error?.message || error)}; }
  if (mine !== st.turn || (st.phase !== 'starting' && st.phase !== 'running')) return;   // a newer press or setReady already decided
  st.steps = read.steps?.length ? read.steps : st.steps;
  st.url = read.url || st.url;
  st.runId = read.runId || st.runId;
  const next = advance({phase: st.phase, read, elapsedMs: Date.now() - st.startedAt, seen: !!st.runId, way: w});
  st.phase = next.phase; st.message = next.message;
  if (next.again) st.timer = setTimeout(() => poll(w), POLL_MS);
  if (w === way) draw();
}

async function press() {
  const w = way, st = states[w];
  clearTimeout(st.timer);
  const mine = ++st.turn;
  Object.assign(st, {phase: 'starting', steps: [], url: '', message: '', runId: 0});
  draw();
  let started;
  try { started = w === 'ours' ? await window.pilot.hostedTestStart() : await window.pilot.cloudTestStart(); } catch (error) { started = {ok: false, error: String(error?.message || error)}; }   // a rejected call ends in a verdict, not a row stuck on "Starting"
  if (mine !== st.turn) return;
  if (!started?.ok) { st.phase = 'failed'; st.message = startFailed(started?.error, w); if (w === way) draw(); return; }
  st.since = started.since; st.after = started.after || 0; st.startedAt = Date.now();
  if (w === 'ours') st.runId = started.run || 0;   // our servers name the run at once: it is "seen" from the first read
  poll(w);
}

/** Called by the GitHub card whenever its three requirements change: `names` are the ones still to set up (empty = the own-accounts test may run). Our servers' test needs none of them. */
export function setReady(names) {
  missing = names;
  const st = states.own;
  if (names.length && (st.phase === 'starting' || st.phase === 'running')) { clearTimeout(st.timer); st.turn++; Object.assign(st, {phase: 'idle', steps: [], message: ''}); }   // a key removed mid-test: the result is no longer about the setup
  if ($('aon-test-go')) draw();
}

/** The way the choice card shows ('own' | 'ours'): the row draws that way's state; the other way's test goes on in the background and its result is kept. */
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
  $('aon-test-open').addEventListener('click', () => window.pilot.openExternal(now().url));
  $('aon-test-title').textContent = NAME;
  draw();
}
