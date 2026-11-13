// The Worker's cron triggers start the nightly build and the three-a-day e2e runs on time (src/scheduler.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AGENT_SLOT, CRONS, SEARCH_WEEKLY, STORE_WEEKLY, jobsFor, NIGHT_SLOTS, nightPassAt, runScheduled, zurichHour} from '../src/scheduler.js';

const at = iso => new Date(iso);

test('the nightly build starts at 04:00 in Zurich, in summer (02:00 UTC) and in winter (03:00 UTC), and only then', () => {
  assert.equal(zurichHour(at('2026-10-05T02:00:00Z')), 4);   // UTC+2
  assert.equal(zurichHour(at('2026-12-05T03:00:00Z')), 4);   // UTC+1
  assert.deepEqual(jobsFor('0 2 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}]);
  assert.deepEqual(jobsFor('0 3 * * *', at('2026-10-05T03:00:00Z')), []);   // 05:00 in summer: not its turn
  assert.deepEqual(jobsFor('0 3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}]);
  assert.deepEqual(jobsFor('0 2 * * *', at('2026-12-05T02:00:00Z')), []);   // 03:00 in winter
});

test('the three-a-day e2e runs start the scheduled plan; an unknown cron starts nothing', () => {
  assert.deepEqual(jobsFor('47 21,23,1 * * *', at('2026-10-05T09:47:00Z')), [{workflow: 'e2e.yml', inputs: {scheduled: 'true'}}]);
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T00:00:00Z')), [], '02:00 Zurich in summer: no replay is started here any more (owner, 17 Oct 2026)');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T01:00:00Z')), [], '03:00 in summer: nothing');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'the nightly: 04:00 Zurich in summer');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-12-05T01:00:00Z')), [], 'in winter 01:00 UTC is 02:00: nothing either');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'and 03:00 UTC is 04:00');
  assert.deepEqual(jobsFor('1 1 * * *', at('2026-10-05T01:01:00Z')), []);
  assert.deepEqual(jobsFor('40 */3 * * *', at('2026-10-05T09:40:00Z')), [{workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}}]);
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'the one nightly trigger fires at 02:00 UTC in summer');
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-10-05T03:00:00Z')), [], 'and at 03:00 UTC it is 05:00 in summer: not its turn');
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'in winter 03:00 UTC is 04:00');
  assert.ok(CRONS.length <= 3, 'the account has 5 cron triggers across ALL Workers and the others hold 2: a 4th here was refused (14 Oct 2026)');
  assert.deepEqual(CRONS, ['0 0,1,2,3 * * *', '47 21,23,1 * * *', '*/10 * * * *']);
});

// Why (7 Nov 2026, gl, owner: "Redrawn on a timer too"): the Gitar label sweep rides the same tick, so a label is at most ten minutes behind Gitar's comment.
test('the ten-minute cron starts the PR verdict sweep and the Gitar label sweep on every tick without dispatch inputs', () => {
  for (const minute of ['00', '10', '20', '30', '40', '50']) {
    const jobs = jobsFor('*/10 * * * *', at(`2026-10-31T00:${minute}:00Z`));
    assert.deepEqual(jobs.filter(job => job.workflow === 'pr-verdict.yml'), [{workflow: 'pr-verdict.yml'}], minute);
    assert.deepEqual(jobs.filter(job => job.workflow === 'pr-labels.yml'), [{workflow: 'pr-labels.yml'}], minute);
  }
});

test('the Store review check starts once an hour, at minute 20 of the ten-minute trigger, and at no other tick', () => {
  const day = new Date(Date.UTC(2026, 10, 5));
  const starts = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 10) {
    const now = new Date(day.getTime() + minutes * 60000);
    if (jobsFor('*/10 * * * *', now).some(job => job.workflow === 'msix-store-watch.yml')) starts.push(now.toISOString().slice(11, 16));
  }
  assert.deepEqual(starts, Array.from({length: 24}, (_, hour) => `${String(hour).padStart(2, '0')}:20`));
});

test('the night burn-in starts five full e2e passes at five different UTC times, on the ten-minute trigger, and nothing at any other tick', () => {
  assert.deepEqual(NIGHT_SLOTS, ['21:00', '23:30', '01:30', '03:30', '05:30']);
  const day = new Date(Date.UTC(2026, 9, 31));
  const started = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 10) {
    const now = new Date(day.getTime() + minutes * 60000);
    const night = jobsFor('*/10 * * * *', now).filter(job => job.workflow === 'e2e.yml');
    if (night.length) started.push([now.toISOString().slice(11, 16), night]);
  }
  assert.deepEqual(started.map(([time, jobs]) => [time, jobs[0].inputs.night_pass, jobs.length]), [['01:30', '3/5', 1], ['03:30', '4/5', 1], ['05:30', '5/5', 1], ['21:00', '1/5', 1], ['23:30', '2/5', 1]]);
  assert.deepEqual(jobsFor('*/10 * * * *', new Date('2026-10-31T21:00:00Z')), [{workflow: 'pr-verdict.yml'}, {workflow: 'pr-labels.yml'}, {workflow: 'e2e.yml', inputs: {night_pass: '1/5'}}], 'the verdict and label sweeps keep their tick');
  assert.equal(nightPassAt(new Date('2026-10-31T21:10:00Z')), '', 'a tick next to a slot is not a pass');
  assert.deepEqual(CRONS, ['0 0,1,2,3 * * *', '47 21,23,1 * * *', '*/10 * * * *'], 'no 4th trigger');
});

// Guard: money — the Find jobs recordings are no longer re-recorded on a timer (owner, 13 Nov 2026, "Retire the replay"): each re-record spent about 3 h of Codex-plan calls.
test('no tick of the day starts the Find jobs re-record (press-tapes-auto.yml)', () => {
  const day = new Date(Date.UTC(2026, 10, 3));
  for (let minutes = 0; minutes < 24 * 60; minutes += 10) {
    const now = new Date(day.getTime() + minutes * 60000);
    assert.deepEqual(jobsFor('*/10 * * * *', now).filter(job => job.workflow === 'press-tapes-auto.yml'), [], `no re-record at ${now.toISOString().slice(11, 16)}`);
  }
});

test('the AI user agent starts once a day at 04:40 UTC, alone on its tick, on the ten-minute trigger', () => {
  const day = new Date(Date.UTC(2026, 10, 3)), started = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 10) {
    const now = new Date(day.getTime() + minutes * 60000), jobs = jobsFor('*/10 * * * *', now).filter(job => job.workflow === 'ai-user-agents.yml');
    if (jobs.length) started.push([now.toISOString().slice(11, 16), jobs]);
  }
  assert.deepEqual(started, [[AGENT_SLOT, [{workflow: 'ai-user-agents.yml', inputs: {scheduled: 'true'}}]]]);
  assert.deepEqual(jobsFor('*/10 * * * *', new Date('2026-11-03T04:40:00Z')).map(job => job.workflow), ['pr-verdict.yml', 'pr-labels.yml', 'ai-user-agents.yml'], 'no stats start, no night pass shares its tick');
  assert.ok(!NIGHT_SLOTS.includes(AGENT_SLOT));
});

test('sharing the ten-minute cron preserves exactly eight stats starts per UTC day', () => {
  const starts = [], legacy = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 10, 20, 30, 40, 50]) {
      const now = new Date(Date.UTC(2026, 9, 31, hour, minute));
      const stats = jobsFor('*/10 * * * *', now).filter(job => job.workflow === 'self-heal-stats.yml');
      if (stats.length) {
        assert.deepEqual(stats, [{workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}}]);
        starts.push(now.toISOString().slice(11, 16));
      }
      if (minute === 40 && hour % 3 === 0) legacy.push(...jobsFor('40 */3 * * *', now));
    }
  }
  assert.deepEqual(starts, ['00:40', '03:40', '06:40', '09:40', '12:40', '15:40', '18:40', '21:40']);
  assert.equal(legacy.length, 8, 'the old cron keeps working during deployment');
});

test('a scheduled start calls the dispatcher; a failed one tells the owner, lets the others start, then fails the cron', async () => {
  const calls = [], told = [];
  const dispatch = async (env, inputs, workflow) => { calls.push([workflow, inputs]); };
  const started = await runScheduled({cron: '0 2 * * *', scheduledTime: Date.parse('2026-10-05T02:00:00Z')}, {}, {dispatch, notify: async text => told.push(text)});
  assert.deepEqual(started, ['desktop.yml']);
  assert.deepEqual(calls, [['desktop.yml', {nightly: 'true'}]]);
  const failing = async () => { throw new Error('GitHub dispatch failed: 403 Resource not accessible'); };
  await assert.rejects(runScheduled({cron: '47 21,23,1 * * *', scheduledTime: Date.parse('2026-10-05T09:47:00Z')}, {}, {dispatch: failing, notify: async text => told.push(text)}),
    /scheduled start failed: e2e\.yml: GitHub dispatch failed: 403/, 'a cron that started nothing must not report success (6 Oct 2026: a day of 401s, every cron "success")');
  assert.match(told[0], /e2e\.yml failed.*403/);
});

test('a refused dispatch (not a 404) is raised', async () => {
  const refused = async () => { throw new Error('GitHub dispatch failed: 403 nope'); };
  await assert.rejects(runScheduled({cron: '0 0,1,2,3 * * *', scheduledTime: Date.parse('2026-10-05T02:00:00Z')}, {}, {dispatch: refused}), /403/);
});

test('failed verdict sweep ticks fail the cron without paging and still allow stats to start', async () => {
  for (const minute of ['10', '40']) {
    const calls = [], told = [], reported = [];
    const dispatch = async (env, inputs, workflow) => {
      calls.push(workflow);
      if (workflow === 'pr-verdict.yml' || workflow === 'pr-labels.yml') throw new Error('GitHub dispatch failed: 403 nope');
    };
    await assert.rejects(runScheduled({cron: '*/10 * * * *', scheduledTime: Date.parse(`2026-10-31T00:${minute}:00Z`)}, {},
      {dispatch, notify: async text => told.push(text), report: async text => reported.push(text)}), /scheduled start failed: pr-verdict\.yml: GitHub dispatch failed: 403 nope; pr-labels\.yml: GitHub dispatch failed: 403/);
    assert.deepEqual(calls, minute === '40' ? ['pr-verdict.yml', 'pr-labels.yml', 'self-heal-stats.yml'] : ['pr-verdict.yml', 'pr-labels.yml']);
    assert.deepEqual(told, [], 'a sustained sweep failure must not page Telegram 144 times a day');
    assert.deepEqual(reported, [], 'the ten-minute sweep must not churn the watchdog issue');
  }
});

test('the Search check week (5 runs a person) starts once a week, Thursday 03:00 UTC, after the night; every other start of it stays the 2-run night (owner, 11 Nov 2026: "2 runs nightly, 5 runs weekly")', () => {
  const starts = [];
  for (let minutes = 0; minutes < 14 * 24 * 60; minutes += 10) {
    const now = new Date(Date.UTC(2026, 10, 9) + minutes * 60000);   // Monday 9 Nov, two weeks
    for (const job of jobsFor('*/10 * * * *', now)) if (job.workflow === 'search-personas.yml') starts.push([now.toISOString().slice(5, 16), job.inputs.presses || 'night']);
  }
  assert.deepEqual(starts.filter(([, presses]) => presses === '5').map(([at]) => at), ['11-12T03:00', '11-19T03:00'], 'the AI cost of 5 runs a person, once a week');
  assert.equal(starts.filter(([at, presses]) => presses === 'night' && at.endsWith('T00:00')).length, 14, 'the night is unchanged');
  assert.equal(starts.length, 16);
  assert.equal(SEARCH_WEEKLY.day, 4);
});

test('the Microsoft Store submission starts once a week, Monday 07:00 UTC, on the ten-minute trigger (7 Nov 2026, owner: weekly, a fixed day)', () => {
  const started = [];
  for (let minutes = 0; minutes < 14 * 24 * 60; minutes += 10) {
    const now = new Date(Date.UTC(2026, 10, 2) + minutes * 60000);   // Monday 2 Nov, two weeks
    if (jobsFor('*/10 * * * *', now).some(job => job.workflow === 'msix-store-weekly.yml')) started.push(now.toISOString());
  }
  assert.deepEqual(started, ['2026-11-02T07:00:00.000Z', '2026-11-09T07:00:00.000Z']);
  assert.equal(STORE_WEEKLY.day, 1);
  assert.deepEqual(jobsFor('*/10 * * * *', new Date('2026-11-09T07:00:00Z')).map(job => job.workflow), ['pr-verdict.yml', 'pr-labels.yml', 'msix-store-weekly.yml'], 'alone on its tick but for the two PR sweeps');
});
