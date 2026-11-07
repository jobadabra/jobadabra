// Settings → Schedules shows what a person cares about: Find jobs and Check Gmail & Calendar. The employer run and Insights are not rows (owner, 5 Nov 2026: the product sends insights).
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cadence, crons} from '../../../lib/cadence.js';
import {hostedRuns, nextWord, scheduleWith, searchNextAt, whereRuns} from '../../../renderer/schedule-line.js';

const read = name => readScreenSource(new URL(`../../../renderer/${name}`, import.meta.url), 'utf8');

test('Schedules has two rows, Find jobs and Gmail, and no employer or Insights row', () => {
  const html = read('index.html');
  const block = html.slice(html.indexOf('id="setting-schedule"'), html.indexOf('id="setting-focus"'));
  assert.deepEqual([...block.matchAll(/data-schedule="([a-z]+)"/g)].map(m => m[1]), ['search', 'mail']);
  assert.doesNotMatch(block, /More employers|Insights/);
});

test('Reports → Insights has no switch: the product sends insights, and a saved choice is still read by the engine as before', () => {
  assert.doesNotMatch(read('pages/reports.js'), /insightsSwitch|insights-switch/);
  assert.equal(cadence({schedule: {insights: 'off'}}).insights, 'off');   // lib/pipeline-args.js and lib/github.js read it as they did
  assert.equal(cadence({}).insights, 'daily');
});

test('saving one row writes only that row: a new install is not switched to a daily employer run', () => {
  assert.deepEqual(scheduleWith(undefined, 'search', 6), {search: 6});
  assert.deepEqual(scheduleWith({scout: 'daily', mail: 1}, 'insights', 'off'), {scout: 'daily', mail: 1, insights: 'off'});   // a saved choice stays as it was
  const saved = scheduleWith(undefined, 'mail', 1);
  assert.equal(cadence({schedule: saved}).scout, 'off');
  assert.equal(crons({schedule: saved})['scout.yml'], null);
});

test('an older install pinned to daily keeps its employer run after the row is gone (UI only; when Find jobs looks for employers is its own design)', () => {
  const pinned = {schedule: {scout: 'daily'}};
  assert.equal(cadence(pinned).scout, 'daily');
  assert.match(crons(pinned)['scout.yml'], /^\d+ \d+ \* \* \*$/);
});

test('what people act on does not name the employer search: the few-jobs button, the Find jobs words, the progress step and its chip (owner, 5 Nov 2026)', async () => {
  const few = read('pages/activity-few-jobs.js'), html = read('index.html'), steps = readScreenSource(new URL('../../../lib/search-steps.js', import.meta.url), 'utf8');
  assert.match(few, /'secondary item-action', 'Search wider'/);
  assert.doesNotMatch(few + html + steps, /Find more employers|finds more employers|finding more employers|Growing your sources/);
  const {stepChips} = await import('../../../renderer/find-card-model.js');
  const label = line => stepChips(['Searching job boards…', line]).map(chip => `${chip.label}:${chip.state}`).join(' ');
  assert.match(label('Searching wider…'), /Wider search:active/);
  assert.match(label('Growing your sources: finding more employers…'), /Wider search:active/, 'a log written before 5 Nov still draws its step');
});

test('Ready to send and Apply for me are visible rows with a Coming soon chip and no control, and say nothing about where they run (owner, 5 Nov 2026)', () => {
  const html = read('index.html');
  const rows = [...html.matchAll(/<div class="task-row is-soon">([\s\S]*?)<\/div>/g)].map(m => m[1]);
  assert.equal(rows.length, 2);
  rows.forEach((row, i) => {
    assert.match(row, new RegExp(`<b>${['Ready to send', 'Apply for me'][i]}</b>`));
    assert.match(row, />Coming soon</);
    assert.doesNotMatch(row, /<select|<input|<button|data-schedule|Mac|GitHub|servers/i);
  });
});

test('each job says where it really runs: Find jobs by Always on, Gmail always this Mac (owner, 5 Nov 2026: "say where")', () => {
  assert.equal(whereRuns('search', {}), 'This Mac, while open');
  assert.equal(whereRuns('search', {cloudRepo: 'me/jobs'}), 'GitHub, your Mac can be off');
  assert.equal(whereRuns('search', {hostedOn: true}), 'Our servers, your Mac can be off');
  assert.equal(whereRuns('search', {hostedOn: true, cloudRepo: 'me/jobs'}), 'Our servers, your Mac can be off');   // both on: ours is the one the person turned on in the app
  for (const where of [{}, {cloudRepo: 'me/jobs'}, {hostedOn: true}]) assert.equal(whereRuns('mail', where), 'This Mac, while open');
});

test('Find jobs keeps its next run time under "On" wherever it runs: the server\'s on our servers, the app\'s on GitHub or this Mac (owner, 5 Nov 2026)', () => {
  assert.equal(searchNextAt({appAt: 111}), 111);                                         // this Mac or GitHub: lib/schedule.js
  assert.equal(searchNextAt({hostedOn: true, hostedAt: '2026-11-07T07:00:00Z', appAt: 111}), '2026-11-07T07:00:00Z');   // never the Mac's own time beside "Our servers"
  assert.equal(searchNextAt({hostedOn: true, appAt: 111}), null);                         // the server has not said: no time, not the Mac's
});

test('"Our servers" is named only while they really run the search, and a garbled server time prints nothing (review, 5 Nov 2026)', () => {
  assert.equal(hostedRuns({on: true, schedule: {state: 'active'}}), true);
  assert.equal(hostedRuns({on: true, schedule: null}), true);                          // on, the server has not answered yet
  assert.equal(hostedRuns({on: true, schedule: {state: 'paused', pause_reason: 'inactive'}}), false);   // paused: nothing runs there, so say where it does
  assert.equal(hostedRuns({on: false}), false);
  assert.equal(hostedRuns(undefined), false);
  const now = new Date(2026, 10, 6, 10, 0);
  assert.equal(nextWord(new Date(2026, 10, 6, 21, 21), now), 'Today 21:21');
  assert.equal(nextWord(new Date(2026, 10, 7, 7, 0), now), 'Tomorrow 07:00');
  assert.equal(nextWord('garbage', now), '');
  assert.equal(nextWord(null, now), '');
});

test('Schedules redraws its place and time when the servers\' state arrives or GitHub changes, not only on the next activity update (review, 5 Nov 2026)', () => {
  assert.match(read('pages/hosted.js'), /shared\.hosted = now;\s*drawChoice\(\);\s*showScheduleState\(\);/);
  const cloud = read('pages/connections.js');
  assert.match(cloud.slice(cloud.indexOf('export function showCloud')), /drawChoice\(\);\s*showScheduleState\(\);/);
});
