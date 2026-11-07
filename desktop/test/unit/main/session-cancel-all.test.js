// "Cancel all applications" (owner, 5 Nov 2026: in place of the header's Stop): one question, then every unfinished application goes the way its own Cancel does; a submitted one is never touched.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import * as terminals from '../../../lib/terminals.js';
import {registerSessionHandlers} from '../../../lib/session-handlers.js';
import {cancellable} from '../../../renderer/session-state.js';

const here = path.resolve(import.meta.dirname, '../../..');

function setup({choice = 0, unapply = async () => ({ok: true}), hiddenCancel = async () => ({closed: true}), whileAsked = () => {}} = {}) {
  terminals._reset();
  const handles = new Map(), calls = [], dialogs = [], logs = [], writes = {now: 0, most: 0};
  registerSessionHandlers({ipcMain: {handle: (name, fn) => handles.set(name, fn)}, appLog: (area, message) => logs.push(`${area}: ${message}`),
    storage: {}, getWindow: () => null, here, DEMO: false, nativeImage: {createFromPath: () => ({})},
    dialog: {showMessageBox: async (_window, options) => { dialogs.push(options); whileAsked(); return {response: choice}; }},
    background: () => ({cancel: async id => { calls.push(`hidden browser closes ${id}`); return hiddenCancel(id); }}),
    closeTab: async ({id}) => { calls.push(`Chrome tab closes ${id}`); return true; },
    review: {queueClose: () => {}, tabOpen: () => undefined, delivered: async () => false, tabOf: () => '', forget: () => {}, allStates: () => []},
    pipeline: {unapply: async (_storage, url) => {
      calls.push(`back to Kit ready ${url}`);
      writes.most = Math.max(writes.most, ++writes.now);
      try { await new Promise(setImmediate); return await unapply(url); } finally { writes.now--; }   // a write that takes a turn: an overlapping one would be counted
    }}, server: {}, claudeConsent: async () => true});
  // Fictional jobs: one filling in Chrome, one queued in Jobadabra's browser, one waiting on the person, one already submitted.
  terminals.startForm({id: 'chrome', url: 'https://jobs.example.test/1', company: 'Northwind'});
  terminals.startForm({id: 'hidden', url: 'https://jobs.example.test/2', company: 'Contoso'});
  terminals.record('hidden').background = {mode: 'auto', state: 'queued'};
  terminals.startForm({id: 'waiting', url: 'https://jobs.example.test/3', company: 'Fabrikam'});
  terminals.noteStuck('waiting', 'incomplete');
  terminals.startForm({id: 'sent', url: 'https://jobs.example.test/4', company: 'Litware'});
  terminals.setOutcome('sent', 'submitted');
  // A Read with Claude session reads a job board: not an application, never cancelled with them (pages/sessions.js stillOpen).
  terminals.startForm({id: 'reading', url: 'https://jobs.example.test/board', company: 'Board read'});
  terminals.record('reading').kind = 'read';
  // Full automation pressed Submit on this one and waits for the site's reply: only that reply (or the person) settles it.
  terminals.startForm({id: 'sending', url: 'https://jobs.example.test/5', company: 'Tailspin'});
  terminals.record('sending').background = {mode: 'auto', state: 'submitting'};
  return {cancelAll: () => handles.get('sessionsCancelAll')({}), cancel: id => handles.get('sessionCancel')({}, id), calls, dialogs, logs, writes};
}

test('one question names every unfinished application; after yes each is cancelled its own way and the submitted one stays', async () => {
  const s = setup();
  assert.deepEqual(cancellable(terminals.list()).map(item => item.id), ['chrome', 'hidden', 'waiting'], 'the button counts what the handler cancels');
  assert.deepEqual(await s.cancelAll(), {ok: true, count: 3});
  assert.equal(s.dialogs.length, 1, 'asked once, not once per application');
  assert.match(s.dialogs[0].message, /all 3 applications/);
  assert.match(s.dialogs[0].detail, /Northwind[^\n]*\n[^\n]*Contoso[^\n]*\n[^\n]*Fabrikam/, 'one line per application');
  assert.doesNotMatch(s.dialogs[0].detail, /Litware|Tailspin|Board read/, 'a submitted application, one being sent, or a board read is not in the question');
  assert.match(s.dialogs[0].detail, /Nothing is submitted/);
  assert.ok(s.calls.includes('Chrome tab closes chrome') && s.calls.includes('hidden browser closes hidden'), JSON.stringify(s.calls));
  assert.ok(!s.calls.some(call => /\/4|\/5|sending|board|reading/.test(call)), 'the submitted job and the one being sent are never reset or closed');
  assert.deepEqual(terminals.list().map(item => item.id).sort(), ['reading', 'sending', 'sent']);
  assert.equal(s.writes.most, 1, 'the tabs close together; the store is written one job at a time');
});

test('"Keep them" changes nothing, and with nothing unfinished nobody is asked', async () => {
  const kept = setup({choice: 1});
  assert.deepEqual(await kept.cancelAll(), {ok: false, cancelled: true});
  assert.deepEqual(kept.calls, []);
  assert.equal(terminals.list().length, 6);
  const empty = setup();
  for (const id of ['chrome', 'hidden', 'waiting']) terminals.remove(id);
  assert.deepEqual(await empty.cancelAll(), {ok: true, count: 0});
  assert.equal(empty.dialogs.length, 0);
});

test('a store that refuses one job keeps that session and names it; the others are still cancelled', async () => {
  const s = setup({unapply: async url => (url.endsWith('/2') ? {ok: false, error: 'offline'} : {ok: true})});
  const result = await s.cancelAll();
  assert.equal(result.ok, false);
  assert.equal(result.count, 2);
  assert.match(result.error, /Contoso/);
  assert.deepEqual(terminals.list().map(item => item.id).sort(), ['hidden', 'reading', 'sending', 'sent']);
});

test('one application whose close throws is named; the others are still cancelled', async () => {
  const s = setup({hiddenCancel: async () => { throw new Error('the hidden browser did not start'); }});
  const result = await s.cancelAll();
  assert.equal(result.ok, false);
  assert.equal(result.count, 2);
  assert.match(result.error, /Contoso/);
  assert.deepEqual(terminals.list().map(item => item.id).sort(), ['hidden', 'reading', 'sending', 'sent']);
});

test('an application that was submitted, or started sending, while the question was open is left alone and not counted', async () => {
  const s = setup({whileAsked: () => { terminals.setOutcome('chrome', 'submitted'); terminals.record('hidden').background = {mode: 'auto', state: 'submitting'}; }});
  assert.deepEqual(await s.cancelAll(), {ok: true, count: 1});
  assert.ok(!s.calls.some(call => /chrome|hidden|\/1|\/2/.test(call)), JSON.stringify(s.calls));
  assert.deepEqual(terminals.list().map(item => item.id).sort(), ['chrome', 'hidden', 'reading', 'sending', 'sent']);
});

test('the single Cancel application refuses a job that is being sent: its reply settles it', async () => {
  const s = setup();
  const result = await s.cancel('sending');
  assert.equal(result.ok, false);
  assert.match(result.error, /being sent/);
  assert.equal(s.dialogs.length, 0);
  assert.ok(terminals.get('sending'));
});

// Owner, 7 Nov 2026 (Claude Desktop run, item 7): "Cancel all gives no feedback while it works. It takes about 8 seconds, with only a greyed button and the old list still showing."
// After the yes, every application being cancelled says so until its own end; the store is written one job at a time, so the rows leave one by one.
test('after the yes each application reads "cancelling" until its own end; a refused one stops saying it and stays', async () => {
  const seen = [];
  const s = setup({unapply: async url => {
    seen.push(terminals.list().filter(item => item.cancelling).map(item => item.id).sort());
    return url.endsWith('/2') ? {ok: false, error: 'offline'} : {ok: true};
  }});
  assert.deepEqual(terminals.list().filter(item => item.cancelling), [], 'nothing reads cancelling before the question is answered');
  await s.cancelAll();
  assert.deepEqual(seen[0], ['chrome', 'hidden', 'waiting'], 'all three read cancelling when the first store write starts, not only the one being written');
  assert.ok(seen.every(ids => ids.length >= 1), 'an application that has ended no longer reads cancelling');
  assert.ok(seen.at(-1).length < 3, 'the rows that have ended are gone from it');
  assert.deepEqual(terminals.list().filter(item => item.cancelling), [], 'nothing keeps saying cancelling after the call');
  assert.equal(terminals.get('hidden')?.cancelling, false, 'the refused one is back to its own state');
});

test('"Keep them" marks nothing as cancelling', async () => {
  const s = setup({choice: 1, whileAsked: () => assert.deepEqual(terminals.list().filter(item => item.cancelling), [])});
  await s.cancelAll();
  assert.deepEqual(terminals.list().filter(item => item.cancelling), []);
});
