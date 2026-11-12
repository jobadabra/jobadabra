// LinkedIn jobs on every Find jobs, PR 1/3 (spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the switch's state, the ask counters, and the
// copied LinkedIn session as a credential (allow-listed cookies, Keychain only, gone when the switch goes off). lib/linkedin-session.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {COOKIE_NAMES, SERVICE, cleanCookies, noteAnswer, noteAsked, noteRun, pausedUntil, readSession, refreshSession, saveSession, shouldAsk, state, turnOff} from '../../../lib/linkedin-session.js';

const SECRET = 'AQEDAR-fake-li-at-value';
const JSESSION = '"ajax:1234567890"';
const cookie = (name, value, domain = '.linkedin.com') => ({name, value, domain});
const good = () => [cookie('li_at', SECRET), cookie('JSESSIONID', JSESSION, '.www.linkedin.com'), cookie('bcookie', 'v=2&other'), cookie('li_at', 'evil', '.evil.example')];

function store(settings = {}) {
  const mine = {...settings};
  return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)};
}
function keychain() {
  const items = new Map(), calls = [];
  return {items, calls, write: (service, value, options) => { calls.push(['write', service, options]); items.set(service, value); return true; }, read: service => items.get(service) || null,
    remove: service => { calls.push(['remove', service]); return items.delete(service); }};
}

test('only the allow-listed cookies of linkedin.com are kept, and li_at is required', () => {
  assert.deepEqual(COOKIE_NAMES, ['li_at', 'JSESSIONID']);
  assert.deepEqual(cleanCookies(good()), {li_at: SECRET, JSESSIONID: JSESSION});
  assert.equal(cleanCookies([cookie('JSESSIONID', JSESSION)]), null, 'no li_at: no session');
  assert.equal(cleanCookies([cookie('li_at', SECRET, '.evil.example')]), null, 'another site\'s li_at is never taken');
  assert.equal(cleanCookies([cookie('li_at', SECRET, '.notlinkedin.com')]), null, 'a look-alike host is not linkedin.com');
  assert.equal(cleanCookies('nope'), null);
});

test('a cookie value that is not one printable token is refused (nothing odd reaches the Keychain)', () => {
  for (const value of ['', 'two words', 'tab\there', 'line\nbreak', 'x'.repeat(2049), 'café']) assert.equal(cleanCookies([cookie('li_at', value)]), null, JSON.stringify(value).slice(0, 30));
});

test('saving the session puts it in the Keychain under one item, turns the switch on and never returns the value', () => {
  const settings = store({linkedinJobs: {asked: 1}}), kc = keychain();
  const done = saveSession(settings, good(), {keychain: kc});
  assert.deepEqual(done, {ok: true});
  assert.equal(JSON.stringify(done).includes(SECRET), false);
  assert.equal(SERVICE, 'jobadabra.linkedin-jobs.session');
  assert.deepEqual(JSON.parse(kc.items.get(SERVICE)), {li_at: SECRET, JSESSIONID: JSESSION});
  assert.deepEqual(state(settings), {on: true, asked: 1, declined: 0});
  assert.equal(JSON.stringify(settings.settings()).includes(SECRET), false, 'the settings file never holds the session');
  assert.deepEqual(readSession({keychain: kc}), {li_at: SECRET, JSESSIONID: JSESSION});
});

test('a session without li_at changes nothing: the switch stays off and nothing is written', () => {
  const settings = store(), kc = keychain();
  const done = saveSession(settings, [cookie('JSESSIONID', JSESSION)], {keychain: kc});
  assert.equal(done.ok, false);
  assert.match(done.error, /sign in to LinkedIn/i);
  assert.equal(kc.calls.length, 0);
  assert.equal(state(settings).on, false);
});

test('a Keychain that refuses the write leaves the switch off', () => {
  const settings = store(), kc = {...keychain(), write: () => false};
  const done = saveSession(settings, good(), {keychain: kc});
  assert.equal(done.ok, false);
  assert.equal(state(settings).on, false);
});

test('turning off deletes the Keychain item, keeps the ask counters, and can be repeated', () => {
  const settings = store({linkedinJobs: {on: true, asked: 2, declined: 1}}), kc = keychain();
  kc.items.set(SERVICE, JSON.stringify({li_at: SECRET}));
  assert.deepEqual(turnOff(settings, {keychain: kc}), {ok: true});
  assert.equal(kc.items.has(SERVICE), false);
  assert.deepEqual(state(settings), {on: false, asked: 2, declined: 1});
  assert.deepEqual(turnOff(settings, {keychain: kc}), {ok: true});
  assert.equal(readSession({keychain: kc}), null);
});

test('the ask: on the 1st and 2nd Find jobs press while off, never after On or two "Not now"', () => {
  assert.equal(shouldAsk({on: false, asked: 0, declined: 0}), true);
  assert.equal(shouldAsk({on: false, asked: 1, declined: 1}), true);
  assert.equal(shouldAsk({on: false, asked: 2, declined: 1}), false, 'asked twice already');
  assert.equal(shouldAsk({on: false, asked: 1, declined: 2}), false, 'two Not now');
  assert.equal(shouldAsk({on: true, asked: 0, declined: 0}), false, 'already on');
});

test('the counters change only by the dialog: shown = asked + 1, Not now = declined + 1, On changes neither', () => {
  const settings = store();
  noteAsked(settings);
  assert.deepEqual(state(settings), {on: false, asked: 1, declined: 0});
  noteAnswer(settings, 'not-now');
  assert.deepEqual(state(settings), {on: false, asked: 1, declined: 1});
  noteAsked(settings); noteAsked(settings); noteAsked(settings);
  assert.equal(state(settings).asked, 2, 'capped at 2: the dialog is never counted past its limit');
  noteAnswer(settings, 'on');
  assert.equal(state(settings).declined, 1);
  assert.throws(() => noteAnswer(settings, 'maybe'), /unknown answer/);
});

test('the last run and a pause are kept beside the switch, and no other write drops them (LinkedIn jobs 2/3)', () => {
  const settings = store({linkedinJobs: {on: true, asked: 1, declined: 0}});
  noteRun(settings, {state: 'done', jobs: 12, at: '2026-10-31T12:00:00.000Z'});
  assert.deepEqual(settings.settings().linkedinJobs.last, {state: 'done', jobs: 12, at: '2026-10-31T12:00:00.000Z'});
  noteRun(settings, {state: 'limited', jobs: 0, at: '2026-10-31T13:00:00.000Z', pauseUntil: '2026-11-01T13:00:00.000Z'});
  assert.equal(pausedUntil(settings), Date.parse('2026-11-01T13:00:00.000Z'));
  noteAsked(settings);
  noteAnswer(settings, 'not-now');
  assert.equal(settings.settings().linkedinJobs.last.state, 'limited', 'the ask counters do not drop the last run');
  assert.equal(pausedUntil(settings), Date.parse('2026-11-01T13:00:00.000Z'));
  assert.deepEqual(state(settings), {on: true, asked: 2, declined: 1}, 'state() still answers only the three keys');
  turnOff(settings, {keychain: keychain()});
  assert.equal(pausedUntil(settings), 0, 'turning it off forgets the pause: a new yes starts clean');
  assert.equal(settings.settings().linkedinJobs.last, undefined, 'and the last run');
  assert.equal(pausedUntil(store()), 0);
});

test('#2731 the refresh copy: replaces the Keychain item while on; Chrome signed out deletes it; grants gone keeps it; off refuses everything', () => {
  const settings = store(), kc = keychain();
  assert.equal(refreshSession(settings, good(), {keychain: kc}).ok, false, 'off: a copy never arrives');
  assert.equal(kc.items.size, 0);
  saveSession(settings, good(), {keychain: kc});
  const fresh = [cookie('li_at', 'AQEDAR-fresh-value'), cookie('JSESSIONID', '"ajax:55"')];
  const answer = refreshSession(settings, fresh, {keychain: kc});
  assert.deepEqual(answer, {ok: true});
  assert.deepEqual(readSession({keychain: kc}), {li_at: 'AQEDAR-fresh-value', JSESSIONID: '"ajax:55"'});
  assert.equal(JSON.stringify(answer).includes('fresh-value'), false);
  assert.deepEqual(refreshSession(settings, undefined, {keychain: kc, held: false}), {ok: true, kept: true});
  assert.equal(readSession({keychain: kc}).li_at, 'AQEDAR-fresh-value', 'the extension read nothing: the copy stays');
  assert.deepEqual(refreshSession(settings, [], {keychain: kc}), {ok: true, signedOut: true});
  assert.equal(readSession({keychain: kc}), null, 'signed out in Chrome: the copy goes, the step will say no-session');
  assert.equal(state(settings).on, true, "the switch is the person's, not the refresh's");
});

// #3911 (owner, 12 Nov 2026: "Why I don't get any notification or feedback"): the ONE owner of "is the person's LinkedIn sign-in working", written only by a read's verdict (noteRun).
import {nextSignin, signinView} from '../../../lib/linkedin-session.js';

const run = (settings, verdict) => noteRun(settings, {state: verdict, jobs: 0, at: '2026-11-12T18:00:00Z'});
const on = () => store({linkedinJobs: {on: true}});

test('a dead copy is told once per press: signed-out, missing and check each move Working to Needs you with their reason', () => {
  for (const [verdict, why] of [['signed-out', 'signed-out'], ['no-session', 'missing'], ['check', 'check']]) {
    const settings = on();
    assert.deepEqual(signinView(settings), {state: 'ok', why: '', empties: 0}, 'working before any read');
    assert.deepEqual(run(settings, verdict), {event: 'needs-you', why});
    assert.deepEqual(signinView(settings), {state: 'needs-you', why, empties: 0});
    assert.deepEqual(run(settings, verdict), {event: 'needs-you', why}, 'still dead at the next press: the same notice again');
  }
});

test('an empty read is a one-off until it repeats: the 2nd in a row is Needs you (empty), a read that worked in between starts over', () => {
  const settings = on();
  assert.deepEqual(run(settings, 'failed'), {event: null, why: ''}, 'one empty read: the step line only (issue #3710: a working session also read nothing once)');
  assert.deepEqual(run(settings, 'failed'), {event: 'needs-you', why: 'empty'});
  const again = on();
  run(again, 'failed'); run(again, 'done'); run(again, 'failed');
  assert.equal(signinView(again).state, 'ok', 'failed, done, failed is not two in a row');
  const cut = on();
  run(cut, 'failed'); run(cut, 'stopped'); run(cut, 'limited'); run(cut, 'no-browser');
  assert.equal(signinView(cut).empties, 1, 'a stop, a slow-down or a missing browser says nothing about the sign-in');
  assert.equal(run(cut, 'failed').event, 'needs-you');
});

test('a read that worked after Needs you is "renewed", once; a read that worked while Working says nothing', () => {
  const settings = on();
  assert.deepEqual(run(settings, 'done'), {event: null, why: ''});
  run(settings, 'signed-out');
  assert.deepEqual(run(settings, 'done'), {event: 'renewed', why: ''});
  assert.deepEqual(signinView(settings), {state: 'ok', why: '', empties: 0});
  assert.equal(run(settings, 'done').event, null);
});

test('the switch off says nothing; a new yes and Turn off start clean; the state never holds a cookie', () => {
  const off = store({linkedinJobs: {on: false}});
  assert.deepEqual(run(off, 'signed-out'), {event: null, why: ''});
  const settings = on(), kc = keychain();
  run(settings, 'signed-out');
  saveSession(settings, good(), {keychain: kc});
  assert.equal(signinView(settings).state, 'ok', 'a fresh sign-in is Working again');
  run(settings, 'check');
  turnOff(settings, {keychain: kc});
  assert.equal(signinView(settings).state, 'ok');
  assert.equal(JSON.stringify(settings.settings()).includes(SECRET), false);
  assert.deepEqual(nextSignin({state: 'ok', why: '', empties: 0}, 'weird-verdict'), {state: 'ok', why: '', empties: 0}, 'an unknown verdict changes nothing');
});
