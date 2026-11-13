// LinkedIn Easy Apply in Background and Full automation, plan 4a-2b (lib/easy-apply-batch.js): LinkedIn jobs fill in today's hidden browser; the sign-in goes in before a LinkedIn job
// opens and leaves when none is open; while paused, off or with no sign-in, a LinkedIn job that has not opened goes to the person; a check or sign-in page stops LinkedIn 24 h once.
// Guard: privacy — the copied LinkedIn session is a credential (CLAUDE.md Safety): without this it would stay in the hidden browser after the batch, or reach a log.
// Stood in: the hidden browser (a CDP spy that keeps a cookie jar), the Keychain reader, the controller's hand-over; settings are the real lib/easy-apply-limits.js and linkedin-session.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {easyApplyBatch} from '../../../lib/easy-apply-batch.js';
import {STOP_MS} from '../../../lib/easy-apply-limits.js';
import {pausedUntil} from '../../../lib/linkedin-session.js';

const NOW = Date.UTC(2026, 10, 13, 12, 0);
const SECRET = 'FAKE-li_at-value';
function setup({settings = {linkedinJobs: {on: true}, easyApply: {on: true, warnedAt: '2026-11-13T09:00:00Z'}}, session = {li_at: SECRET, JSESSIONID: 'ajax:1'}, failSet = false, refuse = false} = {}) {
  let mine = structuredClone(settings);
  const storage = {settings: () => mine, saveSettings: patch => { mine = {...mine, ...patch}; return mine; }};
  const calls = [], lines = [], handed = [];
  let jar = [], closed = false, sweeps = 0, keptRunning = false;   // jar: what the browser holds (CDP cookies, expiry in seconds); closed: the browser quit
  const send = async (method, params) => {
    calls.push(method);
    if (closed) throw Object.assign(new Error('no port file'), {code: 'ENOENT'});
    if (method === 'Storage.getCookies') return {cookies: jar};
    if (method !== 'Storage.setCookies') throw new Error(`unexpected ${method}`);
    for (const c of params.cookies) { jar = jar.filter(held => !(held.name === c.name && held.domain === (c.domain || new URL(c.url).hostname))); if (!c.expires || c.expires * 1000 > NOW) jar.push({...c, domain: c.domain || new URL(c.url).hostname}); }
    if (failSet && params.cookies.some(c => c.value)) throw new Error('browser gone after writing');   // a put that wrote, then threw
    return {};
  };
  const log = (area, message, fields) => lines.push(JSON.stringify([area, message, fields]));
  const batch = easyApplyBatch({storage, send, readSession: () => session, now: () => NOW, log, sweep: async () => { sweeps += 1; return keptRunning ? {keptRunning: true} : {rows: 2}; }});
  const handOver = async (item, reason) => { handed.push([item.id, reason]); return refuse ? {ok: false, error: 'held by another run'} : {state: 'needs_user_handoff', reason, handoffAt: NOW}; };
  return {batch, handOver, calls, lines, handed, storage, signedIn: () => jar.some(c => c.name === 'li_at' && c.value), held: () => jar,
    close: () => { closed = true; }, reopen: () => { closed = false; }, sweeps: () => sweeps, runAgain: value => { keptRunning = value; }};
}
const job = (id, state, extra = {}) => [{id, url: `https://www.linkedin.com/jobs/view/${id}/`}, {state: {state, ...extra}}];
const other = (id, state) => [{id, url: `https://jobs.example.com/${id}`}, {state: {state}}];

test('a poll with no LinkedIn job makes no browser call', async () => {
  const s = setup();
  await s.batch.settle([other('a', 'queued'), other('b', 'filling')], s.handOver);
  assert.deepEqual(s.calls, []);
});

test('the sign-in goes in before a LinkedIn job opens, stays while one is open, and leaves when none is; never in a log', async () => {
  const s = setup();
  await s.batch.settle([job('j1', 'queued'), other('a', 'queued')], s.handOver);
  assert.equal(s.signedIn(), true, 'in before the launch');
  await s.batch.settle([job('j1', 'ready_for_review')], s.handOver);
  assert.equal(s.signedIn(), true, 'a filled form waiting for the person keeps it');
  await s.batch.settle([job('j1', 'needs_user_handoff', {reason: 'incomplete_or_uncertain'})], s.handOver);
  assert.equal(s.signedIn(), true, 'a form handed to the person on its own page keeps it');
  s.held().push({name: 'bcookie', value: 'x', domain: '.www.linkedin.com', path: '/'}, {name: 'sid', value: 'y', domain: 'jobs.example.com', path: '/'});
  await s.batch.settle([other('a', 'filling')], s.handOver);
  assert.equal(s.signedIn(), false, 'gone when no LinkedIn job is open');
  assert.deepEqual(s.held().map(c => c.name), ['sid'], 'every LinkedIn cookie expired, another site\'s kept');
  assert.ok(!s.lines.some(line => line.includes(SECRET)), 'the value is in no log line');
  const before = s.calls.length;
  await s.batch.settle([other('a', 'filling')], s.handOver);
  assert.equal(s.calls.length, before, 'out once, not on every poll');
});

test('paused, off or no sign-in: a LinkedIn job not opened yet goes to the person and the sign-in never goes in', async () => {
  for (const [name, options, reason] of [
    ['paused', {settings: {linkedinJobs: {on: true, pauseUntil: new Date(NOW + 3600e3).toISOString()}, easyApply: {on: true, warnedAt: 'x'}}}, 'linkedin_paused'],
    ['off', {settings: {linkedinJobs: {on: true}, easyApply: {on: false}}}, 'linkedin_off'],
    ['no sign-in', {session: null}, 'linkedin_signin'],
  ]) {
    const s = setup(options);
    const found = [job('j1', 'queued'), job('j2', 'preflight'), other('a', 'queued')];
    await s.batch.settle(found, s.handOver);
    assert.deepEqual(s.handed, [['j1', reason], ['j2', reason]], name);
    assert.equal(found[0][1].state.state, 'needs_user_handoff', `${name}: the entry carries the hand-over, so no launch goes out`);
    assert.equal(found[2][1].state.state, 'queued', `${name}: another site's job is untouched`);
    assert.equal(s.signedIn(), false, name);
  }
});

test('D3: a check or sign-in page stops LinkedIn 24 h once, and the batch\'s other LinkedIn jobs go to the person', async () => {
  const s = setup();
  await s.batch.settle([job('j1', 'queued')], s.handOver);
  const found = [job('j1', 'needs_user_handoff', {reason: 'sign_in_required', handoffAt: NOW}), job('j2', 'queued')];
  await s.batch.settle(found, s.handOver);
  assert.equal(pausedUntil(s.storage), NOW + STOP_MS, 'the shared pause, 24 h');
  assert.deepEqual(s.handed, [['j2', 'linkedin_paused']]);
  await s.batch.settle([job('j1', 'needs_user_handoff', {reason: 'sign_in_required', handoffAt: NOW})], s.handOver);
  assert.equal(s.storage.settings().easyApply.stops, 1, 'the same hand-off is never a second stop (that would turn Easy Apply off)');
  assert.equal(s.storage.settings().easyApply.on, true);
});

test('a sign-in the browser will not take: the LinkedIn jobs wait (never open signed out) and the poll goes on', async () => {
  const s = setup({failSet: true});
  const found = [job('j1', 'queued'), other('a', 'queued')];
  await s.batch.settle(found, s.handOver);
  assert.equal(found[0][1], null, 'skipped this poll');
  assert.equal(found[1][1].state.state, 'queued');
  assert.deepEqual(s.handed, []);
  await s.batch.settle([other('a', 'filling')], s.handOver);
  assert.equal(s.signedIn(), false, 'a put that wrote before it threw is still taken out by the next poll (Gitar on #4096)');
});

test('a hand-over the store refuses is no hand-over: skipped this poll, and it never keeps the sign-in in', async () => {
  const s = setup({settings: {linkedinJobs: {on: true, pauseUntil: new Date(NOW + 3600e3).toISOString()}, easyApply: {on: true, warnedAt: 'x'}}, refuse: true});
  const found = [job('j1', 'queued')];
  await s.batch.settle(found, s.handOver);
  assert.equal(found[0][1], null, 'skipped, so no launch and the next poll tries again');
  assert.deepEqual(s.calls, [], 'no sign-in put in for it');
});

test('the browser closed with the sign-in in it: its cookie file is swept now, and nothing is tried again for ever (Gitar on #4109)', async () => {
  const s = setup();
  await s.batch.settle([job('j1', 'queued')], s.handOver);
  s.close();
  s.runAgain(true);
  await s.batch.settle([other('a', 'filling')], s.handOver);
  assert.equal(s.sweeps(), 1, 'swept at once');
  s.runAgain(false);
  await s.batch.settle([other('a', 'filling')], s.handOver);
  assert.equal(s.sweeps(), 2, 'a browser that ran again during the sweep is tried again');
  const after = s.calls.length;
  await s.batch.settle([other('a', 'filling')], s.handOver);
  assert.equal(s.calls.length, after, 'once swept, no call on later polls');
  assert.equal(s.sweeps(), 2);
});

test('D3 counts by hand-off: a second check during the pause is the same stop; the next one after the pause is the second, which turns Easy Apply off (Gitar on #4109)', async () => {
  const s = setup();
  await s.batch.settle([job('a', 'needs_user_handoff', {reason: 'captcha_runtime', handoffAt: NOW - 5000})], s.handOver);
  assert.equal(s.storage.settings().easyApply.stops, 1);
  await s.batch.settle([job('a', 'needs_user_handoff', {reason: 'captcha_runtime', handoffAt: NOW - 5000}), job('b', 'needs_user_handoff', {reason: 'sign_in_required', handoffAt: NOW + 1000})], s.handOver);
  assert.equal(s.storage.settings().easyApply.stops, 1, 'a job that met a check during the pause is the same stop');
  assert.equal(s.storage.settings().easyApply.stopAt, NOW + 1000, 'but it is counted, so it is never counted later');
  const later = NOW + STOP_MS + 60e3;
  await s.batch.settle([job('c', 'needs_user_handoff', {reason: 'captcha_preflight', handoffAt: later})], s.handOver);
  assert.equal(s.storage.settings().easyApply.stops, 2, 'a check after the pause ended is the second stop');
  assert.equal(s.storage.settings().easyApply.on, false, 'which turns Easy Apply off (D3)');
});
