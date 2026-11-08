// A hidden-browser session's words in the sessions list, dock and Applying card come from its own background state, never from a Chrome tab it does not have
// (owner screenshots, 28 Oct 2026: Air France, queued behind GLOCK, said "Filling" with a broken picture and "Tab not found"; GLOCK, filling, said "Can't reach form").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {backgroundStatus} from '../../../renderer/background-status.js';
import {liveCard} from '../../../renderer/live-card.js';

const status = state => backgroundStatus({background: {state}});

test('each background state has its own words and tone; a session that is not a hidden-browser one has none', () => {
  assert.deepEqual(status('queued'), ['Queued', 'neutral']);
  assert.deepEqual(status('preflight'), ['Filling', 'info']);
  assert.deepEqual(status('filling'), ['Filling', 'info']);
  assert.deepEqual(status('ready_for_review'), ['Ready for review', 'warn']);
  assert.deepEqual(status('needs_user_handoff'), ['Needs you', 'warn']);
  assert.deepEqual(status('manual_submit_required'), ['Needs you', 'warn']);
  assert.deepEqual(status('waiting_to_submit'), ['Submitting soon', 'info']);
  assert.deepEqual(status('submitting'), ['Submitting…', 'info']);
  assert.equal(backgroundStatus({}), null, 'a Chrome session keeps the Chrome words');
  assert.equal(backgroundStatus({background: {state: 'receipt_confirmed'}}), null, 'a finished one falls through to the usual words');
});

test('a queued job waits for its turn: no live picture, no Filling, Stop only; only the job that is filling gets the live view', () => {
  const queued = liveCard({state: 'queued'}, null);
  assert.deepEqual([queued.kind, queued.title, queued.pill, queued.live], ['waiting', 'Waiting for its turn', ['Queued', 'neutral'], false]);
  assert.match(queued.note, /up to 10 applications at once/);
  for (const state of ['preflight', 'filling']) assert.deepEqual([liveCard({state}, null).kind, liveCard({state}, null).live], ['filling', true], state);
  for (const state of ['ready_for_review', 'needs_user_handoff', 'manual_submit_required']) assert.equal(liveCard({state}, null).live, true, `${state} may be watched (Watch live)`);
});

test('the dock counts a filling hidden-browser job as active, a queued one as waiting its turn, and never calls one "closed" for lacking a Chrome tab', async () => {
  const {dockCounts, dockOrder, tabClosed} = await import('../../../renderer/session-state.js');
  const filling = {id: 'g', kind: 'form', status: 'running', startedAt: '2026-10-28T16:00:00Z', background: {state: 'filling'}};
  const queued = {id: 'a', kind: 'form', status: 'running', startedAt: '2026-10-28T16:00:00Z', background: {state: 'queued'}};
  assert.deepEqual(dockCounts([filling, queued]), {active: 1, needs: 0, waiting: 1}, 'the one that fills is active, the queued one waits');
  const forms = {known: true, ids: [], unsure: []};
  assert.equal(tabClosed(filling, forms, true, Date.parse('2026-10-28T20:00:00Z')), false, 'a hidden-browser session has no Chrome tab to lose');
  assert.equal(tabClosed({...filling, background: undefined}, forms, true), true, 'a Chrome session still reads closed');
  assert.ok(dockOrder(filling, item => tabClosed(item, forms, true)) < 9, 'the filling job is not sorted last as if closed');
});

test('one table: the card\'s pill is the list\'s words, only more exact when the page facts are known (Gitar, #2392)', () => {
  for (const state of ['queued', 'preflight', 'filling', 'ready_for_review', 'needs_user_handoff', 'manual_submit_required']) {
    assert.deepEqual(liveCard({state}, null).pill, backgroundStatus({background: {state}}), `${state}: card and list say the same`);
  }
  const done = {left: [], fields: 4, filled: 4, active: ''};
  assert.deepEqual(liveCard({state: 'ready_for_review'}, done).pill, ['Ready to submit', 'good'], 'the card knows no required field is left');
  assert.deepEqual(backgroundStatus({background: {state: 'ready_for_review'}}, {ready: true}), ['Ready to submit', 'good']);
  assert.deepEqual(liveCard({state: 'filling'}, {left: [], fields: 4, filled: 2}).pill, ['Filling · 2 of 4 fields', 'info']);
});

test('a queued hidden job gets the lowest urgency, so the nav badge stays neutral instead of counting it as working (Gitar, #2392)', async () => {
  const {sessionUrgency, applyingBadge} = await import('../../../renderer/session-state.js');
  const queued = {id: 'a', kind: 'form', status: 'running', background: {state: 'queued'}};
  const filling = {id: 'g', kind: 'form', status: 'running', background: {state: 'filling'}};
  assert.equal(sessionUrgency(queued), 4);
  assert.equal(applyingBadge([queued], item => sessionUrgency(item)).tone, 'neutral');
  assert.equal(sessionUrgency({...queued, background: {state: 'preflight'}}), sessionUrgency({...queued, background: {state: 'filling'}}), 'only queued is demoted');
  assert.equal(applyingBadge([queued, filling], item => sessionUrgency(item)).count, 2);
});

// Why (30 Oct 2026, owner's demo: cards stuck with no reason): with the app's connection for the extension closed, a queued hidden-browser job said "Waiting for its turn" behind a job
// that did not exist. integration/app/screen-apply.test.js ("a silent Chrome in Background automation") plays it in the window; this keeps the one status function and the card honest for every state.
const LINK_OFF = {port: 47111, code: 'EADDRINUSE'};

test('with the connection off a queued job says so in its pill and card; no other state changes', () => {
  assert.deepEqual(backgroundStatus({background: {state: 'queued'}}, {linkOff: true}), ['Connection off', 'warn']);
  const card = liveCard({state: 'queued'}, null, {linkOff: LINK_OFF});
  assert.deepEqual([card.kind, card.live, card.title, card.pill, card.tone], ['waiting', false, 'Jobadabra can\'t hear its browser', ['Connection off', 'warn'], 'warn']);
  assert.match(card.note, /port 47111/);
  assert.doesNotMatch(card.note, /Chrome/, 'a hidden browser is not the person\'s Chrome');
  assert.doesNotMatch(card.note, /up to 10 applications at once/, 'the queue is not the reason');
  const states = ['preflight', 'filling', 'ready_for_review', 'needs_user_handoff', 'manual_submit_required', 'waiting_to_submit', 'submitting', 'receipt_confirmed', ''];
  for (const state of states) {
    assert.deepEqual(backgroundStatus({background: {state}}, {linkOff: true}), backgroundStatus({background: {state}}), `${state}: a running job keeps its own words`);
    assert.deepEqual(liveCard({state}, null, {linkOff: LINK_OFF}), liveCard({state}, null), `${state}: nor its card`);
  }
});

test('every place that words a hidden-browser job tells backgroundStatus whether the connection is off', async () => {
  const fs = await import('node:fs'), path = await import('node:path'), {fileURLToPath} = await import('node:url');
  const renderer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../renderer');
  // Why (8 Nov 2026, owner: "Yes, build it (Recommended)"): the list's pill is the one label (session-state.js sessionLabel), told the connection; the page header reads the list's own label.
  assert.match(fs.readFileSync(path.join(renderer, 'pages/sessions.js'), 'utf8'), /sessionLabel\(item, \{linkOff:/, 'the list words the job with the connection');
  assert.match(fs.readFileSync(path.join(renderer, 'pages/session-log.js'), 'utf8'), /const stateOf = item => sessionState\(item\)/, 'the page header reads the list\'s label');
  assert.match(fs.readFileSync(path.join(renderer, 'pages/session-live.js'), 'utf8'), /liveCard\([^)]*linkOff:/, 'the live card is told too');
});

test('each session shows its own mode at a glance: where it runs and who submits, in its Settings icon (owner, 5 Nov 2026)', async () => {
  const {sessionModeChip} = await import('../../../renderer/background-status.js');
  const {ICON_NAMES} = await import('../../../renderer/icons.js');
  const cases = [[{kind: 'form'}, 'In Chrome · you submit', 'eye'], [{background: {mode: 'fill'}}, 'Background · you submit', 'layers'],
    [{background: {mode: 'auto'}}, 'Full auto · sends itself', 'zap'], [{background: {state: 'queued'}}, 'Background · you submit', 'layers'],
    [{kind: 'claude'}, 'In Chrome · you submit', 'eye'], [{}, 'In Chrome · you submit', 'eye']];
  for (const [item, text, glyph] of cases) {
    const chip = sessionModeChip(item);
    assert.equal(chip.text, text, JSON.stringify(item));
    assert.equal(chip.glyph, glyph);
    assert.ok(ICON_NAMES.includes(chip.glyph), `${glyph} is an icon the app has`);
  }
  assert.match(sessionModeChip({background: {mode: 'auto'}}).title, /^Full automation: Fills and submits/, 'hover: the Settings name and what it does');
  // Review of [ap] 4/7: a bot check, Stop, a mode change or a quit hands a Full automation job to the person; the store keeps mode 'auto', and the chip must not say it sends by itself.
  for (const state of ['needs_user_handoff', 'manual_submit_required']) {
    const chip = sessionModeChip({background: {mode: 'auto', state}});
    assert.equal(chip.text, 'Full auto · you submit', state);
    assert.equal(chip.glyph, 'zap');
    assert.equal(chip.tone, 'violet', 'the mode keeps its colour: the status chip beside it says "Needs you"');
  }
  for (const [id, title] of [['fill', /^Background automation: /], ['check', /^Standard automation: /]]) {
    const item = id === 'check' ? {kind: 'form'} : {background: {mode: id}};
    assert.match(sessionModeChip(item).title, title, `${id}: hover says its Settings name`);
  }
  assert.notEqual(sessionModeChip({background: {mode: 'auto'}}).tone, sessionModeChip({background: {mode: 'fill'}}).tone, 'the mode that sends by itself looks different');
});
