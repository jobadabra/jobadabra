// A session's form tab closed in Chrome: every button that looks for it reopens the form, no question, and never starts Claude.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import * as terminals from '../../../lib/terminals.js';
import {registerSessionHandlers} from '../../../lib/session-handlers.js';

const URL = 'https://jobs.example.test/engineer';
const here = path.resolve(import.meta.dirname, '../../..');

function setup({choice = null, tab = 'eventual', ackAfter = 0, priorTab = '', launchError = '', reused = false} = {}) {
  terminals._reset();
  terminals.usePty(async () => ({spawn: () => ({onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {}})}));
  const handles = new Map(), calls = [], logs = [], dialogs = [];
  let states = [];
  let openedCount = 0, eventualAfter = 0, elapsed = 0, boundTab = priorTab;
  registerSessionHandlers({ipcMain: {handle: (name, fn) => handles.set(name, fn)}, appLog: (area, message) => logs.push(`${area}: ${message}`),
    storage: {}, getWindow: () => null, here, DEMO: false, nativeImage: {createFromPath: () => ({})},
    dialog: {showMessageBox: async (_window, options) => { dialogs.push(options); return {response: choice}; }},
    apply: {openOne: url => {
      calls.push(`open ${url}`); openedCount++;
      if (launchError) return {ok: false, error: launchError};
      if (tab === 'eventual' && ackAfter === 0) boundTab = 'tab-5';
      return {ok: true, reused};
    },
      applyOne: async (_storage, url) => { calls.push(`chrome ${url}`); return {ok: true}; },
      claudeOne: async (_storage, url) => { calls.push(`claude ${url}`); return {ok: true}; }},
    focusTab: async ({id}) => {
      calls.push(`look ${id}`);
      if (tab === 'tab') return 'tab';
      if (tab !== 'eventual') return 'none';
      return openedCount > eventualAfter ? 'tab' : 'none';
    }, verifyOpenedTab: true, pause: async ms => {
      elapsed += ms;
      if (tab === 'delayed' && openedCount && elapsed >= ackAfter) boundTab = 'tab-5';
    },   // pinned timer, no real wait or browser
    review: {forget: id => calls.push(`forget ${id}`), tabOf: () => boundTab, allStates: () => states}, pipeline: {}, server: {}, notion: {}, claudeConsent: async () => true});
  const reopen = (id, stale) => handles.get('sessionReopen')({}, id, stale);
  return {reopen, calls, logs, dialogs, elapsed: () => elapsed, setStates: next => { states = next; },
    setTab: next => { tab = next; ackAfter = 0; boundTab = ''; eventualAfter = openedCount; }};
}

test('nothing from the closed tab on the page: the form reopens without a question', async () => {
  const s = setup();
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  assert.deepEqual(await s.reopen(id, false), {ok: true, reset: false});
  assert.deepEqual(s.calls, ['look f1', `open ${URL}`]);
  assert.equal(s.dialogs.length, 0);
  assert.ok(s.logs.some(line => line.startsWith('review: tab gone f1: nothing to clear')));
});

// Owner, 8 Oct 2026: the card already says Reopen fills the form again from your kit, so no dialog; the closed tab's state goes.
for (const kind of ['form', 'claude']) {
  test(`a ${kind} session with the closed tab's state: no question, the state is cleared, the form reopens, Claude is not started`, async () => {
    const s = setup();
    const {id} = kind === 'form' ? terminals.startForm({id: 'f1', url: URL, company: 'Acme'})
      : await terminals.start({id: 'f1', url: URL, kind: 'claude', file: 'claude'});
    terminals.noteStuck(id, 'account');
    assert.deepEqual(await s.reopen(id, true), {ok: true, reset: true});
    assert.deepEqual(s.calls, ['look f1', 'forget f1', `open ${URL}`]);
    assert.equal(s.dialogs.length, 0);
    assert.equal(terminals.get(id).stuck, '');
    assert.ok(terminals.get(id), 'the session stays');
  });
}

// The class: every place in the session pages that looks for the form's tab hands a closed one to reopenClosedTab, and no
// button opens a fresh tab or tells you to open it yourself.
test('every caller of the form-tab lookup reopens a closed tab through reopenClosedTab', () => {
  const pages = ['session-needs.js', 'sessions.js', 'session-next-step.js', 'session-log.js'].map(name => [name, fs.readFileSync(path.join(here, 'renderer', 'pages', name), 'utf8')]);
  let callers = 0;
  for (const [name, source] of pages) {
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (!/window\.pilot\.(showBrowser|reviewFocus)\(/.test(line)) return;
      callers++;
      assert.match(lines.slice(index, index + 12).join('\n'), /reopenClosedTab\(item/, `${name}:${index + 1} looks for the form tab without reopening a closed one`);
    });
    assert.doesNotMatch(source, /No open Chrome tab (is|matches) this job/, `${name} still asks you to open the form yourself`);
    assert.doesNotMatch(source, /window\.pilot\.applyOne\(item\.url\)/, `${name} reopens a session's form without asking about the closed tab's state`);
  }
  assert.ok(callers >= 3, `expected Open in Chrome, Open filled form and Review in form, found ${callers}`);
});

test('Reopen form reports an error when Chrome never exposes the newly opened tab', async () => {
  const s = setup({tab: 'none'});
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  const result = await s.reopen(id, false);
  assert.equal(result.ok, false, 'a successful launcher call is not proof that Chrome opened a form tab');
  assert.match(result.error, /Chrome|extension|form tab/i);
  assert.ok(s.logs.some(line => line.includes('extension did not confirm the reopened form tab')));
  assert.ok(!s.logs.some(line => line.includes('reopened the form with the fill mark')));
  s.setTab('eventual');
  assert.deepEqual(await s.reopen(id, false), {ok: true, reset: false}, 'a failed launch can be retried immediately');
  assert.equal(s.calls.filter(call => call.startsWith('open ')).length, 2);
});

test('an extension-confirmed reused tab needs no new tab id acknowledgement', async () => {
  const s = setup({tab: 'none', priorTab: 'live-tab', reused: true});
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  assert.deepEqual(await s.reopen(id, false), {ok: true, reset: false});
  assert.equal(s.elapsed(), 0, 'reuse is returned only for a tab the extension reports as open');
});

test('Reopen form does not accept a stale extension binding as acknowledgement', async () => {
  const s = setup({tab: 'none', priorTab: 'old-tab'});
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  const result = await s.reopen(id, false);
  assert.equal(result.ok, false, 'the old tab id cannot prove this launch opened a new tab');
  assert.equal(s.elapsed(), 20000, 'waits through the regular tab acknowledgement window');
});

test('Reopen form waits for a delayed read-only extension acknowledgement', async () => {
  const s = setup({tab: 'delayed', ackAfter: 2500});
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  assert.deepEqual(await s.reopen(id, false), {ok: true, reset: false});
  assert.equal(s.elapsed(), 2500, 'the tab can bind after a cold Chrome start without a focus probe');
  assert.equal(s.calls.filter(call => call.startsWith('look ')).length, 1, 'only the initial existing-tab check focuses');
});

// Owner, 15 Oct 2026: the live tab had been redirected to the employer's own host; the app looked by the original address, said "gone" and opened a new tab (twice).
test('a second press waits for the same delayed extension acknowledgement', async () => {
  const s = setup({tab: 'delayed', ackAfter: 2500});
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  const first = s.reopen(id, false);
  await Promise.resolve();
  const second = s.reopen(id, false);
  assert.deepEqual(await Promise.all([first, second]), [{ok: true, reset: false}, {ok: true, reset: false}]);
  assert.equal(s.elapsed(), 2500, 'both callers await one acknowledgement window');
  assert.equal(s.calls.filter(call => call.startsWith('open ')).length, 1);
});

test('a pending acknowledgement still shares one launch after the duplicate throttle expires', async t => {
  const s = setup({tab: 'delayed', ackAfter: 19000});
  t.mock.method(Date, 'now', () => 100000 + s.elapsed());
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  const first = s.reopen(id, false);
  while (s.elapsed() < 16000) await Promise.resolve();
  const second = s.reopen(id, false);
  assert.deepEqual(await Promise.all([first, second]), [{ok: true, reset: false}, {ok: true, reset: false}]);
  assert.equal(s.calls.filter(call => call.startsWith('open ')).length, 1);
});

test('an immediate launcher refusal stays an error on an immediate retry', async () => {
  const s = setup({tab: 'none', launchError: 'Browser launch refused'});
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  for (let press = 0; press < 2; press++) assert.deepEqual(await s.reopen(id, false), {ok: false, error: 'Browser launch refused'});
  assert.equal(s.calls.filter(call => call.startsWith('open ')).length, 2);
});

test('a tab that still carries the fill mark (even on another host) is focused, not reopened', async () => {
  const s = setup({tab: 'tab'});
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  assert.deepEqual(await s.reopen(id, true), {ok: true, reset: false, focused: true});
  assert.deepEqual(s.calls, ['look f1']);   // nothing opened, nothing cleared
  assert.ok(s.logs.some(line => line.includes('focused it instead of reopening')));
});
test('Reopen form pressed twice opens one form', async () => {
  const s = setup();
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  await s.reopen(id, false); await s.reopen(id, false);
  assert.equal(s.calls.filter(call => call.startsWith('open ')).length, 1);
});
test('the tab lookup finds a redirected tab by its mark on any host and window', async () => {
  const {tabOfSession} = await import('../../../lib/session-tab.js');
  const tabs = [{id: '1', win: 1, url: 'https://news.example.test/'}, {id: '9', win: 2, url: 'https://career74.other-host.test/apply#jobpilotto-fill=f1'}];
  assert.equal(tabOfSession('f1', tabs, '')?.id, '9');
  assert.equal(tabOfSession('f2', tabs, ''), null);
});

test('Reopen starts from the job posting, even when a form page was seen (owner, 16 Oct 2026)', async () => {
  const s = setup();
  const {id} = terminals.startForm({id: 'f9', url: URL, company: 'Acme'});
  s.setStates([{id, formUrl: 'https://career74.example.test/apply'}]);
  await s.reopen(id, true);
  assert.ok(s.calls.includes(`open ${URL}`), s.calls.join(' | '));
});

