// Exercise the actual lifecycle callbacks with fake Electron and pipeline services.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {claimInstance, startWhenReady, installQuitHandling} from '../../../lib/lifecycle.js';

function fixture({choice = 0, busy = {kind: 'search'}, queue = [], sessions = [], listed = [], important = [], importantDone = Promise.resolve(), platform = 'darwin', ask = false, demo = false, smoke = false, dataJob = false, hasEngines = false} = {}) {
  const calls = [], handlers = {};
  let drain, timeout, engines = hasEngines;
  const idle = new Promise(resolve => { drain = resolve; });
  const app = {on: (event, fn) => { handlers[event] = fn; }, quit: () => calls.push('quit')};
  const storage = {settings: () => ({}), saveSettings: patch => calls.push(patch)};
  const window = {show: () => calls.push('show'), isDestroyed: () => false};
  const beforeQuit = installQuitHandling({app, platform, state: () => ({storage, window, demo, smoke}),
    pipeline: {running: () => busy, queued: () => queue, taskName: () => 'Search', freezeQueue: value => { assert.equal(value, storage); calls.push('freeze'); },
      stopRunning: () => { calls.push('stop'); engines = false; return Promise.resolve(); }, hasChildren: () => engines, whenIdle: () => idle},
    terminals: {running: () => sessions, list: () => listed, label: () => 'Company', shutdown: () => calls.push('shutdown')},
    critical: {labels: () => important, whenDone: () => importantDone},
    dataRunning: () => dataJob, stopDataJob: () => { calls.push('stop-data'); dataJob = false; return Promise.resolve(); },
    shouldAskOnQuit: () => ask, askWhyLeaving: () => calls.push('ask'),
    showDialog: (_parent, options) => { calls.push(options.buttons); return choice; }, icon: () => ({}), getWindows: () => [window],
    toWindow: (...args) => calls.push(args), notify: (...args) => calls.push(args), onCancel: () => calls.push('cancelled'), later: (fn, ms) => { timeout = fn; assert.equal(ms, 300000); },
  });
  return {app, handlers, calls, drain, idle, timeout: () => timeout(), quit: () => beforeQuit({preventDefault: () => calls.push('prevent')})};
}

test('quit when done notifies, waits for idle, and allows the final quit without prompting again', async () => {
  const f = fixture(); f.quit();
  assert.ok(f.calls.some(value => Array.isArray(value) && value[0] === 'Jobadabra will quit when done'));
  assert.ok(!f.calls.includes('quit'));
  f.drain(); await f.idle; await new Promise(resolve => setImmediate(resolve));   // it also waits for important work (none here)
  assert.equal(f.calls.at(-1), 'quit');
  const count = f.calls.length; f.quit(); assert.equal(f.calls.length, count);
});
test('quit now freezes the queue before stopping work; cancel does neither', () => {
  const f = fixture({choice: 1}); f.quit(); assert.deepEqual(f.calls.slice(-3), ['freeze', 'stop', 'quit']);
  const cancel = fixture({choice: 2}); cancel.quit(); assert.ok(!cancel.calls.includes('quit')); assert.ok(!cancel.calls.includes('stop'));
});
test('quit now, and any other quit (will-quit), stop a running data job and wait for it before the app goes', async () => {
  const now = fixture({choice: 1, dataJob: true}); now.quit();
  assert.ok(!now.calls.includes('quit')); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(now.calls.slice(-3), ['stop', 'stop-data', 'quit']);
  // an unasked quit (update install, last window closed): will-quit holds until the job is gone, then quits again
  const other = fixture({busy: null, dataJob: true}); let prevented = false;
  other.handlers['will-quit']({preventDefault: () => { prevented = true; }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true); assert.deepEqual(other.calls.slice(-2), ['stop-data', 'quit']);
  other.handlers['will-quit']({preventDefault: () => assert.fail('the second pass must go through')});
  assert.ok(other.calls.includes('shutdown'));
  const idle = fixture({busy: null}); idle.handlers['will-quit']({preventDefault: () => assert.fail('no job, no hold')});
});
test('sessions-only keep opens the running session; stop quits; waiting sessions do not block', () => {
  const sessions = [{id: 's1', status: 'running'}];
  const keep = fixture({busy: null, sessions}); keep.quit(); assert.deepEqual(keep.calls.at(-1), ['session', 'open', {id: 's1'}]);
  const stop = fixture({busy: null, sessions, choice: 1}); stop.quit(); assert.equal(stop.calls.at(-1), 'quit');
  const waiting = fixture({busy: null, sessions: [{id: 's1', status: 'input'}]}); waiting.quit(); assert.deepEqual(waiting.calls, []);
});
test('setup feedback is asked before quit and the timeout quits; demo and smoke bypass prompts', () => {
  const f = fixture({ask: true}); f.quit(); assert.ok(f.calls.includes('ask')); assert.ok(f.calls.some(value => value?.leaveAsked)); f.timeout(); assert.equal(f.calls.at(-1), 'quit');
  for (const options of [{demo: true}, {smoke: true}]) { const bypass = fixture(options); bypass.quit(); assert.deepEqual(bypass.calls, []); }
});
test('window close quits on Windows only; terminal shutdown runs on will-quit', () => {
  for (const platform of ['darwin', 'win32']) {
    const f = fixture({platform}); f.handlers['window-all-closed'](); assert.equal(f.calls.includes('quit'), platform === 'win32');
    f.handlers['will-quit'](); assert.equal(f.calls.at(-1), 'shutdown');
  }
});
test('instance ownership and ready/activate callbacks preserve startup ordering', async () => {
  const handlers = {}, calls = []; let window = null, ready = false;
  const app = {requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), isReady: () => ready,
    on: (event, fn) => { handlers[event] = fn; }, quit: () => calls.push('quit')};
  const createWindow = () => { calls.push('create'); window = {isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus')}; };
  const firstCopy = claimInstance({app, onDuplicate: () => calls.push('duplicate'), onSecondCopy: () => calls.push('second'), getWindow: () => window, createWindow});
  handlers['second-instance'](); assert.deepEqual(calls, []);
  await startWhenReady({app, firstCopy, start: () => calls.push('start'), getWindows: () => window ? [window] : [], createWindow});
  assert.deepEqual(calls, ['start']); ready = true; handlers['second-instance']();
  assert.deepEqual(calls.slice(-5), ['second', 'create', 'restore', 'show', 'focus']);   // the first copy logs the launch, then brings its window forward
  handlers.activate(); assert.equal(calls.filter(value => value === 'create').length, 1);
  window = null; handlers.activate(); assert.equal(calls.at(-1), 'create');
  app.requestSingleInstanceLock = () => false;
  assert.equal(claimInstance({app, onDuplicate: () => calls.push('duplicate'), getWindow: () => window, createWindow}), false);
  await Promise.resolve(); assert.deepEqual(calls.slice(-2), ['duplicate', 'quit']);
});
test('moving the app does not install activation callbacks or start a second instance', async () => {
  const handlers = {}; let starts = 0;
  const app = {whenReady: () => Promise.resolve(), on: (name, fn) => { handlers[name] = fn; }};
  await startWhenReady({app, firstCopy: false, start: () => { starts++; }});
  await startWhenReady({app, firstCopy: true, start: () => { starts++; return false; }});
  assert.equal(starts, 1); assert.deepEqual(handlers, {});
});

test('an export alone still asks before quitting, and Quit when done waits for it (6 Oct 2026: the app closed mid-export)', async () => {
  let finish;
  const exporting = new Promise(resolve => { finish = resolve; });
  const f = fixture({busy: null, important: ['Exporting your data'], importantDone: exporting});
  f.drain(); f.quit();
  assert.ok(f.calls.includes('prevent'));
  assert.ok(f.calls.some(value => Array.isArray(value) && value[0] === 'Quit when done'));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!f.calls.includes('quit'), 'not before the export is done');
  finish(); await exporting; await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.at(-1), 'quit');
  const cancel = fixture({busy: null, important: ['Exporting your data'], choice: 2}); cancel.quit();
  assert.ok(!cancel.calls.includes('quit'));
});
test('both ways of staying (Cancel, keep sessions) tell the restart to stand down; stopping or quitting does not', () => {
  assert.ok(fixture({choice: 2}).quit() === undefined);
  const cancel = fixture({choice: 2}); cancel.quit(); assert.ok(cancel.calls.includes('cancelled'));
  const keep = fixture({busy: null, sessions: [{id: 's1', status: 'running'}]}); keep.quit(); assert.ok(keep.calls.includes('cancelled'));
  const now = fixture({choice: 1}); now.quit(); assert.ok(!now.calls.includes('cancelled'));
});

// Why (2026-10-28, owner: "Always close it but show that popup about the user confirming the quit considering there are active processes running"): a hidden-browser job has no terminal, so only its background state says it works.
test('quit with only an application filling in the hidden browser asks first; a finished or waiting-for-review one does not', () => {
  const job = state => ({id: 'a', kind: 'form', status: 'done', company: 'Air France', background: {state}});
  for (const state of ['queued', 'preflight', 'filling', 'waiting_to_submit', 'submitting']) {
    const f = fixture({busy: null, listed: [job(state)]}); f.quit();
    assert.deepEqual(f.calls.filter(Array.isArray).at(0), ['Keep working', 'Stop and quit'], `${state} asks`);
    assert.ok(!f.calls.includes('quit'), `${state} waits for the answer`);
  }
  for (const state of ['ready_for_review', 'needs_user_handoff', 'receipt_confirmed']) {
    const f = fixture({busy: null, listed: [job(state)]}); f.quit();
    assert.ok(!f.calls.includes('prevent'), `${state} quits without asking`);
  }
});

test('any quit with a data job and an engine child stops the job, then the children, and only then shuts down (31 Oct 2026, owner: quit ends every child)', async () => {
  const both = fixture({busy: null, dataJob: true, hasEngines: true});
  const events = [];
  both.handlers['will-quit']({preventDefault: () => events.push('hold')});
  await new Promise(resolve => setImmediate(resolve));
  both.handlers['will-quit']({preventDefault: () => events.push('hold')});
  await new Promise(resolve => setImmediate(resolve));
  both.handlers['will-quit']({preventDefault: () => assert.fail('nothing left to wait for')});
  assert.deepEqual(events, ['hold', 'hold']);
  assert.deepEqual(both.calls.filter(call => ['stop-data', 'stop', 'quit', 'shutdown'].includes(call)), ['stop-data', 'quit', 'stop', 'quit', 'shutdown']);
  const none = fixture({busy: null}); none.handlers['will-quit']({preventDefault: () => assert.fail('no child, no hold')});
  assert.ok(none.calls.includes('shutdown'));
});

// Windows tester on 0.9.2, 3 Nov 2026 (issue #3060): starting the app while it runs showed a "Jobadabra is already running" dialog instead of bringing the open window forward.
test('a second copy quits on its own, with no callback needed and no other app call', async () => {
  const calls = [];
  const app = new Proxy({requestSingleInstanceLock: () => false, whenReady: () => Promise.resolve(), on: () => {}, quit: () => calls.push('quit')},
    {get: (target, name) => { if (!(name in target)) throw new Error(`a second copy used app.${String(name)}`); return target[name]; }});
  assert.equal(claimInstance({app, getWindow: () => null, createWindow: () => calls.push('create')}), false);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls, ['quit'], 'it quits at once and creates no window');
});

// cs 4/4 (owner, 10 Nov 2026: "Yes + 'Stop and quit' in case 3"): the quit dialog's three Always on cases, one test each, with the real quit-dialog words.
import {keepCloudAuto} from '../../../lib/cloud-auto.js';
function cloudFixture(kind, choice, chosen = 'quit') {
  const calls = [], hand = {declined: 0}, handlers = {};
  const app = {on: (event, fn) => { handlers[event] = fn; }, quit: () => calls.push('quit')};
  const storage = {settings: () => ({}), saveSettings: () => {}};
  const window = {show: () => calls.push('show'), isDestroyed: () => false};
  keepCloudAuto(storage, {declineQuit: () => { hand.declined++; }});
  const before = installQuitHandling({app, platform: 'darwin', state: () => ({storage, window}), pipeline: {running: () => null, queued: () => [], taskName: () => 'Search', freezeQueue() {}, stopRunning: () => Promise.resolve(), hasChildren: () => false, whenIdle: () => Promise.resolve()},
    terminals: {running: () => [], list: () => [{id: 's1', company: 'Acme', background: {mode: 'auto', state: 'filling'}}], label: () => 'Company', shutdown() {}}, shouldAskOnQuit: () => false,
    showDialog: (_parent, options) => { calls.push(options.buttons); return choice; }, icon: () => ({}), getWindows: () => [window], toWindow: (...args) => calls.push(args), onCancel: () => calls.push('cancelled'),
    cloudQuit: {offerFor: () => kind, chooseCloud: async (_s, asked) => { calls.push(`choose ${asked}`); return chosen; }}});
  return {calls, hand, quit: () => before({preventDefault: () => calls.push('prevent')})};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('Always on off, e-mail on file: the third button turns it on and quits; Stop and quit and Keep working keep their meaning', async () => {
  const turn = cloudFixture('off', 2); turn.quit(); await settle();
  assert.deepEqual(turn.calls[1], ['Keep working', 'Stop and quit', 'Turn on Always on and quit']);
  assert.deepEqual(turn.calls.slice(2), ['choose off', 'quit']);
  const stop = cloudFixture('off', 1); stop.quit(); await settle();
  assert.ok(!stop.calls.some(value => String(value).startsWith('choose')), 'no Always on on Stop and quit');
  assert.equal(stop.calls.at(-1), 'quit');
  const keep = cloudFixture('off', 0); keep.quit(); await settle();
  assert.ok(!keep.calls.includes('quit') && keep.calls.includes('cancelled'));
});
test('Always on off, no e-mail yet (or it could not be turned on): the app stays open and shows Always on\'s card', async () => {
  const setup = cloudFixture('setup', 2, 'stay'); setup.quit(); await settle();
  assert.deepEqual(setup.calls[1], ['Keep working', 'Stop and quit', 'Set up Always on…']);
  assert.ok(!setup.calls.includes('quit'));
  assert.deepEqual(setup.calls.filter(value => Array.isArray(value) && value[0] === 'openTarget'), [['openTarget', {card: 'always-on'}]]);
  assert.ok(setup.calls.includes('cancelled') && setup.calls.includes('show'));
});
test('Always on on: Hand over and quit quits (the departure hook hands them over); Stop and quit stops them and tells the cloud hand-over not to send', async () => {
  const hand = cloudFixture('on', 2); hand.quit(); await settle();
  assert.deepEqual(hand.calls[1], ['Keep working', 'Stop and quit', 'Hand over and quit']);
  assert.equal(hand.calls.at(-1), 'quit');
  assert.equal(hand.hand.declined, 0);
  const stop = cloudFixture('on', 1); stop.quit(); await settle();
  assert.equal(stop.hand.declined, 1, 'this quit hands nothing over');
  assert.equal(stop.calls.at(-1), 'quit');
});
test('the quit dialog is the old one without an offer, and lib/lifecycle.js listens first so a held quit is never handed over before the answer', () => {
  const f = fixture({busy: null, sessions: [{id: 's1', status: 'running'}]}); f.quit();
  assert.deepEqual(f.calls.find(Array.isArray), ['Keep working', 'Stop and quit']);
  const order = [];
  const app = {on: event => order.push(`on ${event}`), prependListener: event => order.push(`prepend ${event}`), quit() {}};
  installQuitHandling({app, platform: 'darwin', state: () => ({}), pipeline: {}, terminals: {}});
  assert.ok(order.includes('prepend before-quit') && !order.includes('on before-quit'), order.join(', '));
});

test('code review (cs 4/4): "Quit now" in the searches-and-sessions dialog says it stops them, so it hands nothing over', () => {
  const storage = {settings: () => ({}), saveSettings() {}}, hand = {declined: 0};
  keepCloudAuto(storage, {declineQuit: () => { hand.declined++; }});
  const app = {on() {}, quit() {}};
  const before = installQuitHandling({app, platform: 'darwin', state: () => ({storage, window: {show() {}, isDestroyed: () => false}}), pipeline: {running: () => ({kind: 'search'}), queued: () => [], taskName: () => 'Search', freezeQueue() {}, stopRunning: () => Promise.resolve(), hasChildren: () => false, whenIdle: () => Promise.resolve()},
    terminals: {running: () => [], list: () => [], label: () => 'C', shutdown() {}}, shouldAskOnQuit: () => false, showDialog: () => 1, icon: () => ({}), getWindows: () => [{}], toWindow() {}});
  before({preventDefault() {}});
  assert.equal(hand.declined, 1);
});
