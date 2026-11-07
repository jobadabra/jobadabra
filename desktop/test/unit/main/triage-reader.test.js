// The triage reader's queue: one read out at a time, a report only for the active one, no clock waited (lib/triage-reader.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTriageReader} from '../../../lib/triage-reader.js';

const clock = () => { const timers = []; return {timers, set: fn => { timers.push(fn); return timers.length - 1; }, clear: id => { timers[id] = null; }, fire: () => timers.forEach(fn => fn && fn())}; };
const reader = (extra = {}) => { let n = 0; return createTriageReader({uuid: () => `id${++n}0000000`, ...extra}); };

test('a queued read is handed to the extension once and answered with the mode table flags', async () => {
  const r = reader(), pending = r.read('https://jobs.example/a');
  const taken = r.take();
  assert.equal(taken.url, 'https://jobs.example/a');
  assert.equal(r.take(), null, 'only one read is out at a time');
  assert.equal(r.report(taken.id, {botCheck: false, loginWall: false, accountCreation: false}), true);
  assert.deepEqual(await pending, {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null});
  assert.equal(r.busy(), false);
});

test('a login wall and a captcha come through as flags', async () => {
  const r = reader(), pending = r.read('https://jobs.example/b');
  r.report(r.take().id, {botCheck: true, loginWall: true});
  const read = await pending;
  assert.deepEqual([read.captcha, read.login, read.accountCreation], [true, true, null], 'a flag nobody gave stays unknown');
});

test('a page that never became a form reads as nothing', async () => {
  const r = reader(), pending = r.read('https://jobs.example/c');
  r.report(r.take().id, {unreadable: true});
  assert.equal(await pending, null);
});

test('a report for an id that is not the active read is refused', async () => {
  const r = reader(), pending = r.read('https://jobs.example/d');
  assert.equal(r.report('nope', {botCheck: false}), false, 'nothing is out yet');
  const {id} = r.take();
  assert.equal(r.report('nope', {botCheck: false}), false);
  assert.equal(r.report(id, {botCheck: false, loginWall: false, accountCreation: false}), true);
  assert.equal(r.report(id, {botCheck: true}), false, 'a second report for the same read is refused');
  await pending;
});

test('a read with no report resolves null when its time is up, and the next read can go', async () => {
  const time = clock(), r = reader({set: time.set, clear: time.clear});
  const first = r.read('https://jobs.example/e'); r.take();
  const second = r.read('https://jobs.example/f');
  assert.equal(r.take(), null, 'the first read is still out');
  time.timers[0]();
  assert.equal(await first, null);
  assert.equal(r.take().url, 'https://jobs.example/f');
  r.cancelAll();
  assert.equal(await second, null);
});

test('Cancel ends every queued and active read with null', async () => {
  const r = reader(), a = r.read('https://jobs.example/g'), b = r.read('https://jobs.example/h');
  r.take();
  assert.equal(r.cancelAll(), 2);
  assert.deepEqual(await Promise.all([a, b]), [null, null]);
  assert.equal(r.busy(), false);
  assert.equal(r.take(), null);
});

test('a read ended without a report (Cancel, a timeout) is handed back once, to close its page; a reported or never-started read is not', async () => {
  const time = clock(), r = reader({set: time.set, clear: time.clear});
  const out = r.read('https://jobs.example/i'), waiting = r.read('https://jobs.example/j'), taken = r.take();
  r.cancelAll();
  await Promise.all([out, waiting]);
  assert.deepEqual(r.takeEnded(), [taken.id], 'only the read the extension holds has a page to close');
  assert.deepEqual(r.takeEnded(), [], 'each is returned once');
  const timed = r.read('https://jobs.example/k'), {id} = r.take();
  time.timers[time.timers.length - 1]();
  assert.equal(await timed, null);
  assert.deepEqual(r.takeEnded(), [id], 'a timeout leaves its page open too');
  const answered = r.read('https://jobs.example/l'), next = r.take();
  r.report(next.id, {botCheck: false, loginWall: false, accountCreation: false});
  await answered;
  assert.deepEqual(r.takeEnded(), [], 'a reported read already closed its own tab');
});

for (const [value, expected] of [[true, true], [false, false], [undefined, null], ['true', null]]) test(`read facts ${value} reach the mode table safely`, async () => {
  const r = reader(), pending = r.read('https://jobs.example/facts');
  r.report(r.take().id, {botCheck: false, loginWall: false, accountCreation: false, allFactsSaved: value});
  assert.equal((await pending).allFactsSaved, expected);
});

test('the read deadline allows the judge and answer plan, without waiting on a clock', async () => {
  let deadline;
  const r = reader({set: (_fn, ms) => { deadline = ms; }, clear: () => {}}), pending = r.read('https://jobs.example/slow');
  assert.equal(deadline, 150000);
  r.cancelAll();
  await pending;
});

// #3519: ten reads took about ten minutes and nothing said which step cost it; each read now says where its time went, and the Jobs dialog hears each step.
const ticking = () => { let t = 1000; return {now: () => t, at: ms => { t = ms; }}; };

test('a read says where its time went: queue, open, judge, plan, and the dialog hears each step as it starts', async () => {
  const clock = ticking(), steps = [], done = [];
  const r = reader({now: clock.now, onStep: step => steps.push(step), onDone: summary => done.push(summary)});
  const pending = r.read('https://jobs.example/t1');
  clock.at(3000);   // 2 s waiting for the browser
  const {id} = r.take();
  clock.at(11000);  // 8 s to open the page and see a form
  assert.equal(r.step(id, 'judging'), true);
  clock.at(60000);  // 49 s of AI judgment
  assert.equal(r.step(id, 'planning'), true);
  clock.at(75000);  // 15 s matching the saved answers
  r.report(id, {botCheck: false, loginWall: false, accountCreation: false, allFactsSaved: true});
  await pending;
  assert.deepEqual(steps.map(item => item.step), ['opening', 'judging', 'planning']);
  assert.deepEqual(done, [{url: 'https://jobs.example/t1', outcome: 'read', totalMs: 74000, queueMs: 2000, openMs: 8000, judgeMs: 49000, planMs: 15000}]);
});

test('a read that never reached a step, or was cut short, says so and counts only the steps it started', async () => {
  const clock = ticking(), done = [];
  const r = reader({now: clock.now, onDone: summary => done.push(summary)});
  const queued = r.read('https://jobs.example/t2');
  clock.at(5000);
  r.cancelAll();
  assert.equal(await queued, null);
  const out = r.read('https://jobs.example/t3');
  clock.at(6000);
  const {id} = r.take();
  clock.at(9000);
  r.step(id, 'judging');
  clock.at(20000);
  r.cancelAll();
  await out;
  assert.deepEqual(done.map(item => [item.outcome, item.queueMs, item.openMs, item.judgeMs, item.planMs]), [['cancelled-before-start', 4000, 0, 0, 0], ['ended-without-report', 1000, 3000, 11000, 0]]);
});

test('a step is accepted once, only for the active read and only if it is a reported step; a failing listener never loses a read', async () => {
  const r = reader({onStep: () => { throw new Error('listener broke'); }, onDone: () => { throw new Error('listener broke'); }});
  const pending = r.read('https://jobs.example/t4');
  const {id} = r.take();
  assert.equal(r.step('nope', 'judging'), false);
  assert.equal(r.step(id, 'opening'), false, 'the app marks opening itself');
  assert.equal(r.step(id, 'dancing'), false);
  assert.equal(r.step(id, 'judging'), true);
  assert.equal(r.step(id, 'judging'), false, 'a repeat is not a new step');
  r.report(id, {botCheck: false, loginWall: false, accountCreation: false});
  assert.ok(await pending);
});

test('a lost judging report never makes two steps count the same time, and the address in the summary has no query', async () => {
  const clock = ticking(), done = [];
  const r = reader({now: clock.now, onDone: summary => done.push(summary)});
  const pending = r.read('https://jobs.example/t5?utm=tracking#frag');
  clock.at(1000);
  const {id} = r.take();
  clock.at(4000);
  r.step(id, 'planning');   // the judging report was lost
  clock.at(9000);
  r.report(id, {botCheck: false, loginWall: false, accountCreation: false});
  await pending;
  assert.deepEqual(done, [{url: 'https://jobs.example/t5', outcome: 'read', totalMs: 8000, queueMs: 0, openMs: 3000, judgeMs: 0, planMs: 5000}]);
});

test('the light look\'s verdict reaches the window as the mode table flags, and a look that could not see the form reads as nothing', async () => {
  const r = reader(), simple = r.read('https://jobs.example/simple');
  r.report(r.take().id, {look: {role: 'form', fields: 5, files: 1, frames: 0}, simple: true, why: ''});
  assert.deepEqual(await simple, {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: ''});
  const gated = r.read('https://jobs.example/gated');
  r.report(r.take().id, {look: {role: 'account', fields: 2, files: 0, frames: 0}, simple: false, why: 'login'});
  assert.equal((await gated).login, true);
  const framed = r.read('https://jobs.example/frame');
  r.report(r.take().id, {unreadable: true, why: 'frame', look: {role: 'form', fields: 0, files: 0, frames: 1}});
  assert.equal(await framed, null);
});
