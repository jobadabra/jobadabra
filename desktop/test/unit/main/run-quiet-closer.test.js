// #3025 (a Windows tester's footer: "Last refresh Mon 09:53 PM · never finished"): a run whose engine the OS ended (sleep, crash, force-quit with no queued job) kept Status
// Running in the store for good; the app only READ it as lost after 30 minutes. The scenario: the app starts, and this Mac's Running rows that went quiet are closed as Failed,
// said in words; a live run, a finished run and a GitHub run are left alone.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as runHistory from '../../../lib/run-history.js';
import {fromRecord, fromRow, LOST_MS} from '../../../lib/run-rows.js';

const json = body => ({ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Map()});
const MINUTE = 60 * 1000;

const now = Date.now();   // clock: relative the reader asks the real clock; every fixture time is minutes before it
const at = minutesAgo => new Date(now - minutesAgo * MINUTE).toISOString();
// A run row as Notion returns it: when it started, when it was last edited (its last sign of life), its status and who started it.
const page = (id, {status = 'Running', started = 120, edited = 90, trigger = 'Mac schedule'} = {}) => ({id, url: `https://app.notion.com/p/${id}`, created_time: at(started), last_edited_time: at(edited),
  properties: {Started: {date: {start: at(started)}}, Mode: {select: {name: 'run'}}, Status: {select: {name: status}}, Trigger: {select: {name: trigger}}, Summary: {rich_text: []}}});

const play = async pages => {
  const calls = [];
  const fetcher = async (url, init) => {
    const route = String(url).replace('https://api.notion.com/v1/', '');
    calls.push([init.method, route, init.body]);
    if (init.method === 'POST') return json({results: pages});
    return json(pages.find(each => route.endsWith(each.id)) || {properties: {}});
  };
  const storage = {secret: () => 'token', settings: () => ({notionIds: {NOTION_CRON_RUNS_DB: 'db'}})};
  const closed = await runHistory.closeQuiet(storage, {fetcher});
  return {closed, patched: calls.filter(call => call[0] === 'PATCH')};
};

test('a Running row of this Mac that nothing touched for 30 minutes is closed as Failed, with when it was last heard from', async () => {
  const quiet = 'a'.repeat(32);
  const {closed, patched} = await play([page(quiet)]);
  assert.equal(closed.length, 1, 'the quiet row is closed');
  assert.equal(patched.length, 1);
  assert.match(patched[0][1], new RegExp(quiet));
  const body = JSON.parse(patched[0][2]);
  assert.equal(body.properties.Status.select.name, 'Failed');
  assert.match(body.properties.Summary.rich_text[0].text.content, /Stopped without finishing: nothing was heard from it after /);
});

test('a live run, a finished run, a run just inside the limit and a GitHub run are left alone', async () => {
  const pages = [page('b'.repeat(32), {started: 10, edited: 1}),                       // live: edited a minute ago
    page('c'.repeat(32), {status: 'OK', started: 300, edited: 290}),                    // finished long ago
    page('d'.repeat(32), {started: 60, edited: LOST_MS / MINUTE - 1}),                  // silent 29 minutes: not yet lost
    page('a1'.repeat(16), {started: 300, edited: 1}),                                  // started 5 hours ago but still beating its heart: alive, not quiet
    page('e'.repeat(32), {trigger: 'Schedule'}),                                        // a GitHub run: it is not this Mac's to close
    page('f'.repeat(32))];                                                              // positive control: the one quiet Mac row
  const {closed, patched} = await play(pages);
  assert.deepEqual(patched.map(call => call[1].slice(-32)), ['f'.repeat(32)], 'only the quiet Mac row');
  assert.equal(closed.length, 1);
});

test('the app\'s two readers agree on what is quiet: a Notion row and a store record both say so', () => {
  const row = fromRow(page('a'.repeat(32)), now);
  assert.equal(row.quiet, true, 'a Notion row');
  const record = fromRecord({id: 7, started_at: at(120), mode: 'run', status: 'Running', trigger: 'Mac schedule', where: 'mac', stats: {duration_s: 30 * 60}, summary: ''}, now);
  assert.equal(record.quiet, true, 'a store record (the heartbeat stopped 90 minutes ago)');
  assert.ok(!fromRow(page('b'.repeat(32), {started: 10, edited: 1}), now).quiet, 'a live run is not quiet');
});

test('the app does it on every start, even when no job was queued at the quit', async () => {
  const {createAppReminders} = await import('../../../lib/app-reminders.js');
  const pages = [page('a'.repeat(32)), page('b'.repeat(32), {started: 10, edited: 1})], calls = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const route = String(url).replace('https://api.notion.com/v1/', '');
    calls.push([init.method, route]);
    return init.method === 'POST' ? json({results: pages}) : json(pages.find(each => route.endsWith(each.id)) || {properties: {}});
  };
  try {
    const storage = {secret: () => 'token', settings: () => ({notionIds: {NOTION_CRON_RUNS_DB: 'db'}})};
    const {resumeQueue} = createAppReminders({FOCUS_HOURS: [], Notification: class {}, dialog: {}, log: () => {}, notify: () => {}, skippedLoops: new Set(), getStorage: () => storage, targets: {}, toWindow: () => {}, getWindow: () => null});
    await resumeQueue([]);   // a start with an empty queue: the old code returned here
    assert.deepEqual(calls.filter(call => call[0] === 'PATCH').map(call => call[1].slice(-32)), ['a'.repeat(32)], 'the quiet row is closed, the live one is not');
  } finally { globalThis.fetch = realFetch; }
});
