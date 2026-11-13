/* global document */
// Jobs' call to action for scores from the previous strategy, its own re-score card, the "Score first" gate and the muted old scores (owner, 2 Nov 2026:
// "I don't think we should clear all the scoring instantly, but rather show a stale/warning message ... a very visible call to action ... on the jobs list ... to rescore
// ... but still, there should be the old scored." / "Find jobs should be only for finding jobs. But pressing Find jobs should open a dialog saying: Score first").
// One counter and one running state (renderer/pages/rescore-run.js), one sentence (renderer/rescore-words.js) for Strategy's notice and Jobs. tests/unit/ai/test_strategy_outdated.py
// checks the engine marks the rows and counts them like Strategy; desktop/integration/app/screen-jobs-rescore.test.js plays it in the window.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

const read = file => readScreenSource(new URL(`../../../${file}`, import.meta.url), 'utf8');
const body = install();
const make = (tag, id, extra = {}) => { const node = globalThis.document.createElement(tag); node.id = id; Object.assign(node, extra); body.append(node); return node; };
const call = make('div', 'jobs-unscored'), text = make('span', 'jobs-unscored-text'), go = make('button', 'jobs-unscored-go'), card = make('section', 'rescore-card');
call.append(text, go);
const dialog = make('dialog', 'rescore-dialog', {showModal() { this.opened = true; }});
for (const id of ['rescore-title', 'rescore-lead', 'rescore-go', 'score-first-title', 'score-first-lead', 'score-first-go', 'score-first-find']) make('span', id);
const first = make('dialog', 'score-first-dialog', {showModal() { this.opens = (this.opens || 0) + 1; this.open = true; }});
globalThis.localStorage = {getItem: () => null, setItem: () => {}};
let queued = 0, searches = [];
globalThis.window.pilot = new Proxy({rescoreOutdated: async () => ({ok: true, queued})}, {get: (all, key) => all[key] || (async () => null)});

const run = await import('../../../renderer/pages/rescore-run.js');
const {paintScoreCall} = await import('../../../renderer/pages/jobs-score-call.js');
const gate = await import('../../../renderer/pages/score-first.js');
const words = await import('../../../renderer/rescore-words.js');
const toasts = [];
const how = {search: why => { searches.push(why); return Promise.resolve({ok: true}); }, reload: async () => {}, toast: (...args) => toasts.push(args)};

test('old scores are not this callout\'s any more: with a count it says only "not scored yet" (the row is the Jobs bar\'s, rescore-entry.js)', () => {
  run.noteOutdated({count: 12, method: 4, places: 9});
  paintScoreCall(0, false);
  assert.equal(call.hidden, true, 'nothing unscored: no callout, however many old scores wait');
  paintScoreCall(7, false);
  assert.match(text.textContent, /^7 jobs are not scored yet/);
  assert.match(read('renderer/index.html'), /id="jobs-unscored-go"[^>]*>Check now</, 'the button\'s words are the page\'s own');
  assert.doesNotMatch(text.textContent, /previous search settings/, 'the notice\'s sentence lives in the Jobs bar row now');
  assert.equal(call.dataset.kind, undefined);
});

test('no scores from the previous strategy: the callout is the "not scored yet" one, unchanged', () => {
  run.noteOutdated({count: 0, method: 0, places: 0});
  paintScoreCall(7, false);
  assert.equal(call.hidden, false);
  assert.match(text.textContent, /^7 jobs are not scored yet/);
  paintScoreCall(7, true);
  assert.equal(call.hidden, true, 'while the search runs they are being scored');
});

test('a re-score has its own state: the card says so, the call goes, the body attribute is the one switch; it ends back where it was', async () => {
  run.noteOutdated({count: 3, method: 3, places: 0});
  queued = 3;
  const states = [];
  document.addEventListener('rescore-state', () => states.push({busy: !!run.rescoring(), attr: document.body.dataset.rescoring}));
  const started = run.runRescore(3, how);
  assert.deepEqual(run.rescoring(), {count: 3});
  assert.equal(document.body.dataset.rescoring, '1');
  paintScoreCall(0, true);
  assert.equal(call.hidden, true, 'no call to action while it runs');
  assert.match(card.textContent, /Re-scoring 3 jobs/);
  assert.match(card.textContent, /old scores stay/);
  await started;
  assert.equal(run.rescoring(), null);
  assert.equal(document.body.dataset.rescoring, undefined);
  assert.deepEqual(searches, [{reason: 'rescore', count: 3}], 'the existing mechanism: a search whose row says "Re-scoring N older scores"');
  assert.deepEqual(states.map(state => state.busy), [true, false]);
  paintScoreCall(0, false);
  assert.equal(card.children.length, 0, 'the card is gone when it ends');
});

test('one re-score at a time, and a refused one ends cleanly', async () => {
  queued = 2;
  const first = run.runRescore(2, how), second = run.runRescore(2, how);
  await Promise.all([first, second]);
  assert.equal(searches.length, 2, 'the second press started nothing');
  const refused = {...how, search: () => Promise.resolve({ok: false, error: 'No AI credit'})};
  await run.runRescore(2, refused);
  assert.equal(run.rescoring(), null);
  assert.equal(document.body.dataset.rescoring, undefined);
});

test('the row\'s Re-score opens the cost dialog, never starts by itself; the dialog\'s own button is the start', () => {
  run.confirmRescore(5, how);
  assert.equal(dialog.opened, true);
  assert.equal(globalThis.document.getElementById('rescore-go').textContent, 'Re-score 5');
  assert.match(read('renderer/pages/focus-suggestions.js'), /rescore: action => confirmRescore\(action\.count, /, 'the Jobs bar row runs the dialog');
  assert.doesNotMatch(read('renderer/pages/jobs.js'), /confirmRescore/, 'the callout no longer starts one');
  assert.equal((read('renderer/pages/rescore-run.js').match(/window\.pilot\.rescoreOutdated\(\)/g) || []).length, 1, 'one start in the app');
});

test('every Find jobs press goes through the one gate: startSearch asks Score first before it does anything', () => {
  const jobs = read('renderer/pages/jobs.js');
  assert.match(jobs, /export async function startSearch\(why = undefined\) \{\n  const held = await scoreFirst\(why, [^\n]*\n  return held \|\| runSearch\(why\);/);
  assert.match(read('renderer/pages/score-first.js'), /if \(why\?\.reason \|\| why\?\.employers \|\| !count \|\| rescoring\(\)\) return null;/, 'only the plain press; none while it runs; the first run has nothing stale');
  // The class: no surface starts a search any other way (the window's refresh call lives in startSearch alone).
  const surfaces = ['renderer/search-changed.js', 'renderer/pages/strategy-suggestions.js', 'renderer/pages/focus-suggestions.js', 'renderer/pages/activity-render.js', 'renderer/pages/activity-few-jobs.js', 'renderer/pages/jobs-find.js'];
  for (const file of surfaces) assert.doesNotMatch(read(file), /window\.pilot\.refresh\(/, `${file} must press through startSearch`);
  assert.equal((jobs.match(/window\.pilot\.refresh\(why\)/g) || []).length, 1);
});

test('the old score stays on the row, a dashed ring with a refresh badge and no word under it; the palette lists the action', () => {
  const rows = read('renderer/pages/jobs-render.js');
  assert.match(rows, /\$\{old \? ' is-stale' : ''\}/, 'the class and the ring read the same rule');
  assert.match(rows, /const old = isOldScore\(job\);[\s\S]*fitRing\(job\.fit, '', old\)/, 'one rule (fit-ring.js isOldScore, tests/unit/renderer/ring-lead.test.js) for the class and the ring');
  assert.doesNotMatch(rows, /staleLabel/, 'no word under an old ring (owner, 13 Nov 2026: the ring says it)');
  assert.match(read('renderer/style.css'), /body\[data-rescoring\] #find-card \{ display: none; \}/, 'one attribute, one rule: no draw order');
  assert.match(read('renderer/pages/nav.js'), /if \(!\(count > 0\) \|\| rescoring\(\)\) return;\n  add\('Jobs', pressLabel\(count\)/, 'the palette lists Re-score N only while old scores wait');
  assert.match(read('renderer/pages/nav.js'), /dispatchEvent\(new Event\('rescore-ask'\)\)/, 'by an event: nav.js imports neither jobs.js nor startup.js (no-circular)');
  assert.match(read('renderer/pages/focus-suggestions.js'), /addEventListener\('rescore-ask', \(\) => RUN\.rescore\(/, 'and the Jobs bar opens the dialog');
  assert.match(words.scoreFirstLead(4), /Cost: not calculated/, 'no invented cost');
  assert.equal(words.scoreFirstTitle, 'Score first');
});

// Score first, played through the gate itself (the choice is the dialog's returnValue at its close event, as in the window).
// tiny-dom elements have no dispatchEvent: fire the dialog's close listeners (each registered once, as the window's {once: true}).
const closeWith = value => { first.returnValue = value; first.open = false; (first.listeners.close || []).splice(0).forEach(fn => fn()); };

test('Score first: "Re-score N jobs" runs the re-score (queue, then the search saying why) and starts no plain Find', async () => {
  run.noteOutdated({count: 4, method: 4, places: 0});
  queued = 4; searches.length = 0;
  const asked = gate.scoreFirst(undefined, how);
  assert.equal(first.opens > 0, true, 'a plain press with old scores opens the dialog');
  assert.equal(globalThis.document.getElementById('score-first-go').textContent, 'Re-score 4');
  closeWith('go');
  assert.deepEqual(await asked, {ok: true, rescored: true});
  assert.deepEqual(searches, [{reason: 'rescore', count: 4}], 'the one search is the re-score\'s own');
});

test('Score first: Cancel starts nothing; "Find jobs without re-scoring" lets the plain search go on; a second press while it is open stacks nothing', async () => {
  run.noteOutdated({count: 4, method: 4, places: 0});
  searches.length = 0;
  const opened = first.opens;
  const asked = gate.scoreFirst(undefined, how);
  assert.deepEqual(await gate.scoreFirst(undefined, how), {ok: false, held: true}, 'the dialog is open: the second press waits for nothing and opens no second one');
  assert.equal(first.opens, opened + 1);
  closeWith('');
  assert.deepEqual(await asked, {ok: false, held: true});
  assert.deepEqual(searches, []);
  const find = gate.scoreFirst(undefined, how);
  closeWith('find');
  assert.equal(await find, null, 'null: the caller goes on to find');
  for (const why of [{reason: 'rescore', count: 4}, {employers: true}]) assert.equal(await gate.scoreFirst(why, how), null, 'only the plain press is held');
});

test('a plain Find search running: a re-score starts nothing and queues nothing, from every surface; it waits and says so (owner scenario: the old bar was greyed then)', async () => {
  run.noteOutdated({count: 4, method: 4, places: 0});
  queued = 4; searches.length = 0; toasts.length = 0;
  let queuedCalls = 0;
  const pilot = globalThis.window.pilot;
  const real = pilot.rescoreOutdated;
  pilot.rescoreOutdated = async () => { queuedCalls++; return {ok: true, queued: 4}; };
  document.body.dataset.findCard = 'searching';
  try {
    dialog.opened = false;
    run.confirmRescore(4, how);
    assert.equal(dialog.opened, false, 'nobody confirms a start that would be refused');
    await run.runRescore(4, how);   // the Score-first path and a dialog opened before the search began
    assert.equal(queuedCalls, 0, 'no job is queued');
    assert.deepEqual(searches, []);
    assert.equal(run.rescoring(), null);
    assert.equal(toasts.length, 2);
    assert.equal(toasts[0][0], 'Re-score waits');
  } finally {
    delete document.body.dataset.findCard;
    pilot.rescoreOutdated = real;
  }
  await run.runRescore(4, how);
  assert.equal(searches.length, 1, 'the search ended: the same press goes through');
});

test('the Jobs bar\'s row follows the one state: present with old scores, gone while the re-score runs, back or gone after it', async () => {
  const {rescoreEntries} = await import('../../../renderer/rescore-entry.js');
  const rowNow = () => rescoreEntries({count: run.knownOutdated().count, running: !!run.rescoring()}).length;
  run.noteOutdated({count: 3, method: 3, places: 0});
  queued = 3;
  assert.equal(rowNow(), 1, 'old scores: the row');
  const started = run.runRescore(3, how);
  assert.equal(rowNow(), 0, 'while it runs the re-score card says so');
  await started;
  assert.equal(rowNow(), 1, 'the count is read again by the Jobs reload; until then the row is back');
  run.noteOutdated({count: 0, method: 0, places: 0});
  assert.equal(rowNow(), 0, 'the reload says none are left: gone');
});
