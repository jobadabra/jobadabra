// Settings → Schedules shows what a person cares about: Find jobs and Check Gmail & Calendar. The employer run and Insights are not rows (owner, 5 Nov 2026: the product sends insights).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {cadence, crons} from '../../../lib/cadence.js';
import {scheduleWith} from '../../../renderer/schedule-line.js';

const read = name => readFileSync(new URL(`../../../renderer/${name}`, import.meta.url), 'utf8');

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
  const few = read('pages/activity-few-jobs.js'), html = read('index.html'), steps = readFileSync(new URL('../../../lib/search-steps.js', import.meta.url), 'utf8');
  assert.match(few, /'secondary item-action', 'Search wider'/);
  assert.doesNotMatch(few + html + steps, /Find more employers|finds more employers|finding more employers|Growing your sources/);
  const {stepChips} = await import('../../../renderer/find-card-model.js');
  const label = line => stepChips(['Searching job boards…', line]).map(chip => `${chip.label}:${chip.state}`).join(' ');
  assert.match(label('Searching wider…'), /Wider search:active/);
  assert.match(label('Growing your sources: finding more employers…'), /Wider search:active/, 'a log written before 5 Nov still draws its step');
});
