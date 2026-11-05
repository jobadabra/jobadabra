// The ask gate (PR 3/7 of docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md): when the app may invite the person to tell us what went wrong, and who owns that answer.
// Design (fb, 5 Nov 2026): lib/asks.js alone decides. States of one kind of ask: IDLE -> PENDING (a moment passed the gate) -> ANSWERED ("Tell us" pressed) or SNOOZED ("Not now", 14 days).
// The verdicts that move them: a failed application whose cause is ours to fix (the form not reached, the sign-in step) opens PENDING; nothing else does. The No list below is the whole gate.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ASK_FAILED_APPLICATION, createAsks, mayAsk, momentOf} from '../../../lib/asks.js';
import {ASK_WORDS} from '../../../renderer/ask-card-text.js';
import {resultOf} from '../../../lib/application-result.js';

const NOW = Date.parse('2026-11-05T12:00:00Z'), HOUR = 3600 * 1000, DAY = 24 * HOUR;
const settings = (extra = {}) => ({setupDone: true, ...extra});
const store = (initial = settings()) => { const mine = {...initial}; return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)}; };
const spy = () => { const sent = []; return {sent, getWindow: () => ({isDestroyed: () => false, webContents: {send: channel => sent.push(channel)}})}; };

test('only a failure whose cause is ours to fix is a moment: the form was not reached, or the sign-in step', () => {
  const table = [['failed-no-form', ASK_FAILED_APPLICATION], ['failed-account', ASK_FAILED_APPLICATION],
    ['failed-abandoned', null], ['submitted-clean', null], ['submitted-assisted', null], ['submitted-claude', null], ['', null], [undefined, null]];
  for (const [result, kind] of table) assert.equal(momentOf(result), kind, `result "${result}"`);
});

test('the No list: every row says no, and the positive control says yes', () => {
  const kind = ASK_FAILED_APPLICATION;
  assert.equal(mayAsk(settings(), kind, NOW), true, 'positive control: setup done, nothing asked before');
  const no = {
    'setup is not finished': settings({setupDone: false}),
    'another ask 23 hours ago': settings({asks: {lastAt: NOW - 23 * HOUR}}),
    'this ask was snoozed 13 days ago (14 days)': settings({asks: {snoozedAt: {[kind]: NOW - 13 * DAY}}}),
    'the person pressed Tell us 29 days ago (30 days)': settings({asks: {answeredAt: {[kind]: NOW - 29 * DAY}}}),
  };
  for (const [why, given] of Object.entries(no)) assert.equal(mayAsk(given, kind, NOW), false, why);
  const yes = {
    'another ask 25 hours ago': settings({asks: {lastAt: NOW - 25 * HOUR}}),
    'snoozed 15 days ago': settings({asks: {snoozedAt: {[kind]: NOW - 15 * DAY}}}),
    'answered 31 days ago': settings({asks: {answeredAt: {[kind]: NOW - 31 * DAY}}}),
  };
  for (const [why, given] of Object.entries(yes)) assert.equal(mayAsk(given, kind, NOW), true, why);
  assert.equal(mayAsk(settings(), 'unknown-kind', NOW), false, 'a kind nobody defined is never asked');
});

test('a failed application opens one pending ask, tells the window, and counts as the ask of the day', () => {
  const st = store(), win = spy(), asks = createAsks({storage: st, getWindow: win.getWindow, now: () => NOW});
  assert.equal(asks.pending(), null);
  asks.moment('submitted-clean');
  assert.equal(asks.pending(), null, 'a success is not a moment');
  asks.moment('failed-no-form');
  assert.deepEqual([asks.pending(), win.sent], [ASK_FAILED_APPLICATION, ['askMoment']]);
  assert.equal(st.settings().asks.lastAt, NOW);
  asks.moment('failed-account');
  assert.deepEqual(win.sent, ['askMoment'], 'the same ask is not opened twice');
});

test('during setup nothing is asked, and nothing is held for later', () => {
  const win = spy(), asks = createAsks({storage: store(settings({setupDone: false})), getWindow: win.getWindow, now: () => NOW});
  asks.moment('failed-no-form');
  assert.deepEqual([asks.pending(), win.sent], [null, []]);
});

test('"Tell us" and "Not now" close the ask and the gate remembers each differently', () => {
  const st = store(), asks = createAsks({storage: st, getWindow: spy().getWindow, now: () => NOW});
  asks.moment('failed-no-form');
  asks.answer(ASK_FAILED_APPLICATION, 'later');
  assert.equal(asks.pending(), null);
  assert.equal(st.settings().asks.snoozedAt[ASK_FAILED_APPLICATION], NOW);
  const other = store(), again = createAsks({storage: other, getWindow: spy().getWindow, now: () => NOW});
  again.moment('failed-no-form');
  again.answer(ASK_FAILED_APPLICATION, 'tell');
  assert.deepEqual([again.pending(), other.settings().asks.answeredAt[ASK_FAILED_APPLICATION]], [null, NOW]);
  assert.equal(mayAsk(other.settings(), ASK_FAILED_APPLICATION, NOW + DAY * 2), false, 'asked about this once: not again for 30 days');
});

test('a pending ask survives a window reload: the window asks the main process, which still holds it', () => {
  const asks = createAsks({storage: store(), getWindow: spy().getWindow, now: () => NOW});
  asks.moment('failed-account');
  assert.equal(asks.pending(), ASK_FAILED_APPLICATION);
  assert.equal(asks.pending(), ASK_FAILED_APPLICATION, 'reading it does not consume it');
});

test('an answer for a kind that is not pending changes nothing', () => {
  const st = store(), asks = createAsks({storage: st, getWindow: spy().getWindow, now: () => NOW});
  asks.answer(ASK_FAILED_APPLICATION, 'later');
  assert.equal(st.settings().asks, undefined);
});

// Why (code review of 3/7, 5 Nov 2026): the listener turns a finished session into a result word with resultOf and hands it to the gate; this plays that chain from the session records the app really holds.
test('a session that ended without a form or at the sign-in opens the ask; a submitted, abandoned or other-kind one does not', () => {
  const sessions = [
    [{kind: 'form', outcome: 'not submitted', stuck: 'no-form'}, true], [{kind: 'form', outcome: 'not submitted', stuck: 'account'}, true],
    [{kind: 'form', outcome: 'not submitted', stuck: 'closed'}, false], [{kind: 'form', outcome: 'submitted'}, false],
    [{kind: 'claude', outcome: 'submitted'}, false], [{kind: 'search', outcome: 'not submitted', stuck: 'no-form'}, false]];
  for (const [session, opens] of sessions) {
    const asks = createAsks({storage: store(), getWindow: spy().getWindow, now: () => NOW});
    asks.moment(resultOf(session, null));
    assert.equal(asks.pending() === ASK_FAILED_APPLICATION, opens, JSON.stringify(session));
  }
});

test('the look-around (demo) app asks nothing and writes nothing', () => {
  const st = store(), win = spy(), asks = createAsks({storage: st, getWindow: win.getWindow, now: () => NOW, demo: true});
  asks.moment('failed-no-form');
  assert.deepEqual([asks.pending(), win.sent, st.settings().asks], [null, [], undefined]);
});

// Why (Gitar on #3309, 5 Nov 2026): the gate takes its kinds from the card's word table, so no kind can be asked that the window cannot draw.
test('every kind the card has words for may be asked, and nothing else', () => {
  for (const kind of Object.keys(ASK_WORDS)) assert.equal(mayAsk(settings(), kind, NOW), true, kind);
  assert.equal(mayAsk(settings(), 'no-words-for-this', NOW), false);
});
