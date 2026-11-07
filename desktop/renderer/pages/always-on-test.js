// Settings → Always on: the Test button row, for both ways. Own accounts: the engine's `test` run in the person's own GitHub repository (lib/always-on-test.js reads it). Our servers: one real run on the site
// (lib/hosted-search.js testStart/testRead). One owner of each way's state: its `phase`, changed only by press, poll and setReady. Guard: test/unit/renderer/always-on-test-words.test.js (words); the page is checked in the demo.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el, pill, liveDot} from '../components.js';
import {$, show} from './core.js';
import {openNotifyCheck, bindNotifyCheck} from './aon-notify-popup.js';
import {NAME, lead, pillFor, buttonFor, chipFor, summary, startFailed, advance, searchLine, searchWatch, shouldPropose, NOTIFY_CHECK, NOTIFY_SETUP} from '../always-on-test-words.js';

const POLL_MS = 3000, SEARCH_POLL_MS = 15000;   // Why (5 Nov 2026, owner): the verdict is read fast; the first search takes minutes, so it is asked about slowly
// Why (5 Nov 2026, hr 5/6; at): each way keeps its own state (its verdict phase, steps, search line and pop-up proposal), so a test running on our servers is not cut by a look at the own-accounts card and each shows its own last result. The own way is one direct check: no run, so no run id, no url, no polling; only our servers' test polls.
// `turn` counts presses and resets: a read that was in flight when it changed belongs to an older test and is dropped (review of 3/3, 4 Nov 2026).
const fresh = () => ({phase: 'idle', since: 0, runId: 0, turn: 0, startedAt: 0, timer: 0, steps: [], message: '', search: null, proposed: false});
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
    if (step.settings) {   // the test e-mail depends on the person's own choice: the pop-up lets them fix it here
      const unsent = step.state === 'failed' || step.state === 'skipped', check = el('button', 'secondary small aon-check-link', unsent ? NOTIFY_SETUP : NOTIFY_CHECK);
      check.type = 'button';
      check.addEventListener('click', () => openNotifyCheck(press, {propose: unsent ? step.line || true : false}));
      row.append(check);
    }
    return row;
  }));
  show(list, now().steps.length > 0);
}

function draw() {
  const {phase, steps, message} = now(), ready = way === 'ours' || missing.length === 0, button = buttonFor(phase), tone = pillFor(phase);
  $('aon-test-pill').replaceChildren(...(tone ? [pill(tone[0], tone[1], {dot: true})] : []));
  $('aon-test-line').textContent = lead(missing, way);
  const go = $('aon-test-go');
  go.textContent = button.text;
  go.disabled = !ready || button.busy;
  const again = $('aon-notify-test');
  if (again) again.disabled = button.busy;   // the pop-up's Test again is as busy as the Test button: one test at a time (the site limits them)
  go.title = ready ? '' : lead(missing, way);
  $('aon-test-result').textContent = message || summary(phase, steps, way);
  const text = way === 'ours' && phase === 'passed' ? searchLine(now().search) : '';   // a failed test promises no e-mail
  $('aon-test-search').replaceChildren(...(text ? [...(now().search.state === 'running' ? [liveDot('live')] : []), el('span', '', text)] : []));
  drawSteps();
}

async function poll(w) {
  const st = states[w];
  clearTimeout(st.timer);
  const mine = st.turn;
  let read;
  try { read = await window.pilot.hostedTestRead(st.runId, st.since); } catch (error) { read = {found: false, steps: [], error: String(error?.message || error)}; }
  if (mine !== st.turn || (st.phase !== 'starting' && st.phase !== 'running')) return;   // a newer press or setReady already decided
  st.steps = read.steps?.length ? read.steps : st.steps;
  st.runId = read.runId || st.runId;
  st.search = read.search || st.search;
  const next = advance({phase: st.phase, read, elapsedMs: Date.now() - st.startedAt});
  st.phase = next.phase; st.message = next.message || (next.phase === 'failed' && read.error ? t('pagesDynamicSetup.m58', {"error": read.error}) : '');   // a lasting refusal names its reason
  proposeNotifications(w, next);
  if (next.again) st.timer = setTimeout(() => poll(w), POLL_MS);
  else if (w === 'ours') watchSearch(w);
  if (w === way) draw();
}

/** The test found no way to reach the person (its notification step did not go through): once per press, the pop-up opens on this screen to propose switching one on.
 *  Why (5 Nov 2026, owner: "propose him to enable the notification settings … directly from that screen"). Only while this way is on screen and no other dialog is open. */
function proposeNotifications(w, next) {
  const st = states[w], step = shouldPropose({steps: st.steps, again: next.again, proposed: st.proposed});
  const onScreen = w === way && $('aon-test-go')?.offsetParent && !document.querySelector('dialog[open]');   // the Test row is visible: not over another page, not over another dialog (the button is still there)
  if (!step || !onScreen) return;
  st.proposed = true;
  openNotifyCheck(press, {propose: step.line});
}

/** After the verdict, re-read only the first search, slowly, until it ended or 20 minutes passed since the press. It never touches the phase: the verdict was given. */
function watchSearch(w) {
  const st = states[w], mine = st.turn;
  const todo = searchWatch(st.search, st.phase, Date.now() - st.startedAt);
  if (todo === 'late') { st.search = {state: 'late', found: 0, note: ''}; if (w === way) draw(); }
  if (todo !== 'again') return;
  clearTimeout(st.timer);
  st.timer = setTimeout(async () => {
    let read;
    try { read = await window.pilot.hostedTestRead(st.runId, st.since); } catch { read = null; }   // a failed look is asked again at the next tick
    if (mine !== st.turn) return;
    if (read?.search) st.search = read.search;
    if (w === way) draw();
    watchSearch(w);
  }, SEARCH_POLL_MS);
}

/** The own-accounts way: one direct check of every link from the app (about 5 s); no run in the person's repository, so nothing to poll. A rejected call ends in a verdict, never a row stuck on "Testing".
 *  Why (5 Nov 2026, owner: "Direct check, ~5 s"). */
async function checkOwn(st, mine) {
  st.phase = 'running';
  draw();
  let read;
  try { read = await window.pilot.cloudTestCheck(); } catch (error) { read = {ok: false, error: String(error?.message || error)}; }
  if (mine !== st.turn) return;   // a newer press or setReady already decided
  st.steps = read?.steps || [];
  st.phase = read?.ok && read.verdict ? read.verdict : 'failed';
  st.message = read?.ok ? '' : startFailed(read?.error, 'own');
  proposeNotifications('own', {again: false});
  if (way === 'own') draw();
}

async function press() {
  const w = way, st = states[w];
  clearTimeout(st.timer);
  const mine = ++st.turn;
  Object.assign(st, {phase: 'starting', steps: [], message: '', runId: 0, search: null, proposed: false});
  draw();
  if (w === 'own') return checkOwn(st, mine);
  let started;
  try { started = await window.pilot.hostedTestStart(); } catch (error) { started = {ok: false, error: String(error?.message || error)}; }   // a rejected call ends in a verdict, not a row stuck on "Starting"
  if (mine !== st.turn) return;
  if (!started?.ok) { st.phase = 'failed'; st.message = startFailed(started?.error, w); if (w === way) draw(); return; }
  st.since = started.since; st.startedAt = Date.now();
  st.runId = started.run || 0;   // our servers name the run at once
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
  bindNotifyCheck();
  $('aon-test-title').textContent = NAME;
  draw();
}
