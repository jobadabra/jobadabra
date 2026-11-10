// The controller's triage read: handed to the extension only when no application is open, answered through the same route, never a store row or a session (lib/background-apply-controller.js, lib/triage-reader.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';
import {markedSession} from '../../../lib/session-tab.js';
import {createTriageReader} from '../../../lib/triage-reader.js';

const make = ({open = [], ready = true, startGate = null, wakes = [], reader} = {}) => {
  const calls = [], starts = [];
  const controller = createBackgroundApplyController({}, {
    store: {read: async () => null, queue: () => calls.push('store.queue'), claim: () => calls.push('store.claim')},
    browser: {ready: () => ready, start: async () => { starts.push('start'); await startGate; return {owner: 'o1'}; }, wake: async () => { wakes.push('wake'); return true; }},
    ...(reader ? {reader} : {}),
    terminals: {list: () => open, byUrl: () => null, startForm: () => calls.push('terminals.startForm'), record: () => null, report: () => {}},
    config: () => ({}), log: () => {}, token: () => 'fictional', port: 1});
  return {controller, calls, starts};
};
const poll = controller => controller.handle({action: 'poll', owner: 'o1'});

test('a queued read reaches the extension as a read command that carries the session mark, and its report resolves the read', async () => {
  const {controller, calls} = make(), pending = controller.triageRead({url: 'https://jobs.example.test/a'});
  const {jobs} = await poll(controller);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].mode, 'read');
  assert.equal(markedSession(jobs[0].url), jobs[0].session, 'the tab address names the read');
  assert.deepEqual((await poll(controller)).jobs, [], 'one read is out at a time');
  const answer = await controller.handle({action: 'triage-read', owner: 'o1', session: jobs[0].session, botCheck: false, loginWall: true, accountCreation: false});
  assert.deepEqual(answer, {ok: true});
  assert.deepEqual(await pending, {eligible: true, captcha: false, login: true, accountCreation: false, allFactsSaved: null});
  assert.deepEqual(calls, [], 'no store row, no session, no claim');
});

test('every read asks the browser to start, so a hidden browser that closed since the last read is launched again', async () => {
  const {controller, starts} = make();
  const first = controller.triageRead({url: 'https://jobs.example.test/first'});
  await poll(controller);   // the app now knows its owner
  const before = starts.length;
  const second = controller.triageRead({url: 'https://jobs.example.test/second'});
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(starts.length, before + 1, 'start is idempotent and cheap; a read must not trust an owner remembered from a browser that may be gone');
  } finally {
    controller.cancelTriage();
    await Promise.all([first, second]);
  }
});

test('a Cancel pressed while the browser is starting drops that read: it is never queued behind the Cancel', async () => {
  let open; const startGate = new Promise(resolve => { open = resolve; });
  const {controller} = make({startGate}), pending = controller.triageRead({url: 'https://jobs.example.test/slow'});
  controller.cancelTriage();
  open();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual((await poll(controller)).jobs, [], 'nothing is handed to the extension after Cancel');
  assert.equal(await pending, null, 'the read ends unread');
});

test('a read is never handed out while an application is open, and never starts beside one', async () => {
  const held = {id: 's1', url: 'https://jobs.example.test/held', background: {}};
  const {controller} = make({open: [held]});
  assert.equal(await controller.triageRead({url: 'https://jobs.example.test/b'}), null, 'refused at once, not queued');
  const {jobs} = await poll(controller);
  assert.deepEqual(jobs, []);
});

test('without the downloaded browser a read answers null and starts nothing', async () => {
  const {controller} = make({ready: false});
  assert.equal(await controller.triageRead({url: 'https://jobs.example.test/c'}), null);
});

test('a report from another owner or for another session changes nothing', async () => {
  const {controller} = make(), pending = controller.triageRead({url: 'https://jobs.example.test/d'});
  const {jobs} = await poll(controller);
  assert.deepEqual(await controller.handle({action: 'triage-read', owner: 'stranger', session: jobs[0].session, botCheck: false}), {ok: false});
  assert.deepEqual(await controller.handle({action: 'triage-read', owner: 'o1', session: 'other', botCheck: false}), {ok: false});
  controller.cancelTriage();
  assert.equal(await pending, null);
});

test('Cancel ends a read that is out', async () => {
  const {controller} = make(), pending = controller.triageRead({url: 'https://jobs.example.test/e'});
  await poll(controller);
  assert.equal(controller.cancelTriage(), 1);
  assert.equal(await pending, null);
});

test('Cancel tells the extension to close the page of the read it ended, once (#2624)', async () => {
  const {controller} = make(), pending = controller.triageRead({url: 'https://jobs.example.test/f'});
  const {jobs} = await poll(controller);
  controller.cancelTriage();
  await pending;
  assert.deepEqual((await poll(controller)).closes, [{session: jobs[0].session}], 'the poll names the read to close');
  assert.deepEqual((await poll(controller)).closes, [], 'and only once');
});

test('an application waits for a read that is out, and is claimed on the next poll once the read ended', async () => {
  const queued = {id: 's2', url: 'https://jobs.example.test/q', background: {}};
  let open = [], claims = 0;
  const controller = createBackgroundApplyController({}, {
    store: {read: async () => ({session: 's2', state: 'queued', mode: 'background'}), claim: async () => { claims += 1; return {ok: true, state: {mode: 'background'}}; }},
    browser: {ready: () => true, start: async () => ({owner: 'o1'})},
    terminals: {list: () => open, byUrl: () => null, record: () => null, report: () => {}},
    config: () => ({mode: 'background'}), log: () => {}, token: () => 'fictional', port: 1});
  const pending = controller.triageRead({url: 'https://jobs.example.test/a'});
  assert.equal((await poll(controller)).jobs[0].mode, 'read', 'the read is out');
  open = [queued];   // the person starts an application while the read is out
  assert.deepEqual((await poll(controller)).jobs, [], 'no claim and no second read while a read is out');
  assert.equal(claims, 0);
  controller.cancelTriage();
  await pending;
  assert.deepEqual((await poll(controller)).jobs.map(job => job.session), ['s2'], 'the application starts once the read ended');
  assert.equal(claims, 1);
});

// #3519: the extension tells the app which step a read is on; the app tells the Jobs window and writes where the read's time went to app.log.
test('a step report reaches the window, and the finished read writes one app.log line with where its time went', async () => {
  const lines = [], windowEvents = [];
  const {setWindowSignal} = await import('../../../lib/server-hooks.js');
  setWindowSignal((channel, payload) => windowEvents.push([channel, payload]));
  try {
  const controller = createBackgroundApplyController({}, {
    store: {read: async () => null}, browser: {ready: () => true, start: async () => ({owner: 'o1'})},
    terminals: {list: () => [], byUrl: () => null, record: () => null, report: () => {}}, config: () => ({}), log: (...line) => lines.push(line), token: () => 'fictional', port: 1});
  const pending = controller.triageRead({url: 'https://jobs.example.test/steps'});
  const {jobs} = await poll(controller);
  assert.deepEqual(await controller.handle({action: 'triage-step', owner: 'o1', session: jobs[0].session, step: 'judging'}), {ok: true});
  assert.deepEqual(await controller.handle({action: 'triage-step', owner: 'o1', session: jobs[0].session, step: 'bogus'}), {ok: false});
  await controller.handle({action: 'triage-read', owner: 'o1', session: jobs[0].session, botCheck: false, loginWall: false, accountCreation: false});
  await pending;
  assert.deepEqual(windowEvents.map(([channel, payload]) => [channel, payload.step]), [['triageStep', 'opening'], ['triageStep', 'judging']]);
  const summary = lines.find(line => line[1] === 'triage: read finished')?.[2];
  assert.equal(summary?.url, 'https://jobs.example.test/steps');
  assert.equal(summary?.outcome, 'read');
  for (const key of ['totalMs', 'queueMs', 'openMs', 'judgeMs', 'planMs']) assert.equal(typeof summary[key], 'number', key);
  } finally { setWindowSignal(() => {}); }
});

// Why (10 Nov 2026, night burn-in 42721065574 + after-merge 42719857151): the hidden browser's extension asked for a queued read only on its 30 s tab report, so every read
// after the first waited 24-27 s (queueMs) for a look of 1.4-1.7 s. A queued read now wakes the owned worker's poll at once.
test('a queued read wakes the hidden browser at once, so the extension takes it without waiting for its 30 s report', async () => {
  const wakes = [], {controller} = make({wakes}), pending = controller.triageRead({url: 'https://jobs.example.test/wake'});
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(wakes, ['wake'], 'one wake per queued read');
    const {jobs} = await poll(controller);
    assert.equal(jobs[0]?.mode, 'read', 'the read the wake was for is the one handed out');
  } finally {
    controller.cancelTriage();
    await pending;
  }
});

test('a check of 4 jobs on a fake clock: each read is handed out when it is queued (queueMs 0, was up to 30 s each), so 4 reads take 6 s, not about 2 min', async () => {
  const LOOK_MS = 1500, REPORT_MS = 30000;   // a measured light look; the extension's tab report period (extension/report-alarm.js, Chrome's shortest alarm)
  let t = 0;
  const done = [], wakes = [];
  const reader = createTriageReader({now: () => t, set: () => 0, clear: () => {}, onDone: summary => done.push(summary)});
  const {controller} = make({wakes, reader});
  for (const n of [1, 2, 3, 4]) {
    const before = wakes.length, pending = controller.triageRead({url: `https://jobs.example.test/check-${n}`});
    await new Promise(resolve => setImmediate(resolve));
    if (wakes.length === before) t = Math.floor(t / REPORT_MS + 1) * REPORT_MS;   // not woken: the read waits for the extension's next report
    const {jobs} = await poll(controller);
    t += LOOK_MS;
    await controller.handle({action: 'triage-read', owner: 'o1', session: jobs[0].session, simple: true});
    await pending;
  }
  assert.deepEqual(done.map(summary => summary.queueMs), [0, 0, 0, 0], 'no read waits for a report');
  assert.equal(t, 4 * LOOK_MS, 'the check takes its reads, nothing else');
});

test('a read queued while another is out wakes the browser when that one is reported, not at the next 30 s report (/code-review of the wake)', async () => {
  const wakes = [], {controller} = make({wakes});
  const first = controller.triageRead({url: 'https://jobs.example.test/out'});
  const [out] = (await (async () => { await new Promise(resolve => setImmediate(resolve)); return poll(controller); })()).jobs;
  const second = controller.triageRead({url: 'https://jobs.example.test/queued'});
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(wakes, ['wake'], 'queued behind a read that is out: no wake yet, the extension could not take it');
    await controller.handle({action: 'triage-read', owner: 'o1', session: out.session, simple: true});
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(wakes, ['wake', 'wake'], 'the read out ended: the queued one wakes the browser');
    assert.equal((await poll(controller)).jobs[0]?.url.split('#')[0], 'https://jobs.example.test/queued');
  } finally {
    controller.cancelTriage();
    await second;
  }
});
