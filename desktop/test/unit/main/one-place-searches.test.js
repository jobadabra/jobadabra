// [sc] 3/4 (6 Nov 2026, owner: "Yes, one place searches"): while our servers really run the search, this Mac's own scheduled search stands down and the app asks
// for the day's insight itself (the insight used to ride on that scheduled search). Nobody loses a search (servers unreachable or paused: the Mac searches) and the
// AI makes at most one insight a day (the app asks once per UTC day, the engine's own once-a-day rule is the second lock: tests/unit/ai/test_insights.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {insightArgs} from '../../../lib/pipeline-args.js';
import {serversNextAt, serversRunSearch} from '../../../lib/one-place.js';
import {insight} from '../../../lib/pipeline-tasks.js';
import {insightDue, startSchedule} from '../../../lib/schedule.js';

const HOUR = 3600 * 1000;
const day = (d, h, m = 0) => Date.UTC(2026, 10, d, h, m);   // 6 Nov 2026 = a Friday
const base = {setupDone: true};
// The scheduler reads the real clock for a due search and a due Gmail check (only the insight takes an injected one), so those times are relative to now.
const nowIso = () => new Date().toISOString();   // clock: relative the scheduler's due() and mailDue() read the real now
const hoursAgo = hours => new Date(Date.now() - hours * HOUR).toISOString();   // clock: relative same

test('the insight is due once per UTC day, after 04:00 UTC, unless Reports are off or setup is not done', () => {
  assert.equal(insightDue({setupDone: false}, day(6, 9)), false);
  assert.equal(insightDue(base, day(6, 3, 59)), false);                       // the engine says "not due" before 04:00 UTC (src/ai/insights.py SEND_HOUR_UTC)
  assert.equal(insightDue(base, day(6, 4)), true);
  assert.equal(insightDue({...base, lastInsightAt: new Date(day(6, 4, 10)).toISOString()}, day(6, 22)), false);   // asked today: not again
  assert.equal(insightDue({...base, lastInsightAt: new Date(day(6, 4, 10)).toISOString()}, day(7, 4, 1)), true);   // the next UTC day
  assert.equal(insightDue({...base, cloud: {repo: 'me/jobs'}}, day(6, 9)), false);           // GitHub's own run carries its insight: never a second ask from the Mac
  assert.equal(insightDue({...base, schedule: {insights: 'off'}}, day(6, 9)), false);   // a saved "off" is still read (cadence.js)
});

test('the app asks the engine for the day\'s insight only when it is due, never a forced one', () => {
  const args = insightArgs({settings: () => ({}), secret: () => ''});
  assert.equal(args[args.indexOf('--mode') + 1], 'insight');
  assert.ok(args.includes('--if-due') && args.includes('--log-run'));
});

test('servers run the search: only while on and not paused; unreachable or no answer means this Mac keeps searching', async () => {
  const on = {settings: () => ({hostedSearch: {on: true}})}, off = {settings: () => ({hostedSearch: {on: false}})};
  const answers = schedule => ({schedule: async () => schedule});
  assert.equal(await serversRunSearch(off, answers({state: 'active'})), false);
  assert.equal(await serversRunSearch(on, answers({state: 'active', next_run_at: '2026-11-07T07:00:00Z'})), true);
  assert.equal(await serversRunSearch(on, answers({state: 'paused', pause_reason: 'budget'})), false);   // paused: nothing runs there, the Mac must
  assert.equal(await serversRunSearch(on, answers(null)), false);                                        // no answer: the Mac must
  assert.equal(await serversRunSearch(on, {schedule: async () => { throw new Error('offline'); }}), false);
  assert.equal(await serversRunSearch(on, {schedule: () => new Promise(() => {}), hangMs: 20}), false);   // a hung answer must not freeze the scheduler (its busy lock)
});

// One scheduler pass, ended by its own last step (scout) instead of a fixed wait: the scout is due too, so 'end' is the last event of the pass.
const tick = async (settings, flags) => {
  const events = [];
  const schedule = startSchedule({settings: () => settings}, {
    search: async () => { events.push('search'); },
    mail: async () => { settings.lastMailAt = nowIso(); },
    insight: async () => { events.push('insight'); settings.lastInsightAt = new Date(day(6, 9)).toISOString(); },
    scout: async () => { events.push('end'); settings.lastScoutAt = nowIso(); },
  }, null, {soon: () => events.push('soon'), headsUp: 0, firstCheck: 0, clock: () => day(6, 9), ...flags});   // pinned clock: the insight is due from 04:00 UTC, whatever hour the test runs at
  for (const until = Date.now() + 5000; !events.includes('end') && Date.now() < until;) await new Promise(resolve => setTimeout(resolve, 5));
  schedule.stop();
  return events.filter(event => event !== 'end');
};
const dueSearch = () => ({setupDone: true, schedule: {scout: 'daily'}, lastScoutAt: new Date(0).toISOString(), lastSearchAt: hoursAgo(5), lastMailAt: nowIso()});

test('servers run the search: the Mac does not search, does not warn "in 1 minute", and asks for the insight', async () => {
  assert.deepEqual(await tick(dueSearch(), {covered: async () => true}), ['insight']);
});

test('servers do not run it: the Mac searches as before and the insight rides on that search, not a second ask', async () => {
  assert.deepEqual(await tick(dueSearch(), {covered: async () => false}), ['soon', 'search']);
  assert.deepEqual(await tick(dueSearch(), {}), ['soon', 'search']);   // no `covered` given: unchanged scheduler
});

test('the scheduler with the real server check: hostedSearch on and active stands the Mac down, paused keeps it searching', async () => {
  const withServers = state => {
    const settings = {...dueSearch(), hostedSearch: {on: true}};
    const storage = {settings: () => settings};
    return {settings, covered: () => serversRunSearch(storage, {schedule: async () => state})};
  };
  const active = withServers({state: 'active', next_run_at: '2026-11-07T07:00:00Z'});
  assert.deepEqual(await tick(active.settings, {covered: active.covered}), ['insight']);
  const paused = withServers({state: 'paused', pause_reason: 'budget'});
  assert.deepEqual(await tick(paused.settings, {covered: paused.covered}), ['soon', 'search']);   // paused: the Mac searches and its search carries the insight
});

test('Activity and Runs show the servers\' next search while they run it, not the Mac\'s overdue time', async () => {
  const storage = on => ({settings: () => ({hostedSearch: {on}})});
  await serversRunSearch(storage(true), {schedule: async () => ({state: 'active', next_run_at: '2026-11-07T07:00:00Z'})});
  assert.equal(serversNextAt(), Date.parse('2026-11-07T07:00:00Z'));
  assert.equal(serversNextAt(Date.now() + 31 * 60 * 1000), null);   // an old answer is not shown. clock: relative serversNextAt stamps the answer with the real now
  await serversRunSearch(storage(true), {schedule: async () => ({state: 'paused', pause_reason: 'guard'})});
  assert.equal(serversNextAt(), null);                                          // paused: the Mac's own time is the true one
  await serversRunSearch(storage(true), {schedule: async () => ({state: 'active', next_run_at: '2026-11-07T07:00:00Z'})});
  await serversRunSearch(storage(false), {});
  assert.equal(serversNextAt(), null);                                          // turned off: forgotten at once
});

test('no AI set up on this Mac: the insight is not asked and nothing is marked, so it is asked again once an engine exists', async () => {
  const saved = [];
  const storage = {settings: () => ({setupDone: true}), secret: () => '', saveSettings: patch => saved.push(patch)};
  assert.deepEqual(await insight(storage, () => {}), {ok: true, skipped: true});
  assert.deepEqual(saved, []);
});
