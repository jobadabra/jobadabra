// The weekly e2e summary (admin/e2e-weekly.js; spec rule D, owner 28 Oct 2026): the page's numbers, one decision for the owner when a suite was red for 30 days without a catch,
// the last full week of commits, and a Telegram text and issue body that say the same.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decision, issueBody, issueTitle, telegramText, weekly} from '../../tools/ci-intel/lib/e2e-weekly.mjs';
import {summary as topSummary} from '../../tools/ci-intel/lib/e2e-top.mjs';
import {windowOf} from '../../tools/ci-intel/lib/e2e-window.mjs';

const monday = new Date('2026-11-02T07:23:00Z');
const fail = (day, suite, cause, n = 1, min = 10) => ({day, suite, platform: 'mac', cause, n, min, kind: 'nightly'});
const snapshot = {at: '2026-11-02T06:41:00Z',
  days: [{day: '2026-10-30', kind: 'nightly', runs: 4, reds: 3, greens: 1}, {day: '2026-11-01', kind: 'pr', runs: 6, reds: 1, greens: 5}],
  fails: [fail('2026-10-30', 'apply', 'product'), fail('2026-10-30', 'applyflows-1of2', 'flake', 2), fail('2026-10-30', 'quality', 'ai', 1, 40), fail('2026-11-01', 'strategy', 'open'),
    fail('2026-10-10', 'strategy', 'timing', 3, 30), fail('2026-10-12', 'settings', 'product')],
  work: [{day: '2026-10-27', kind: 'product', commits: 30}, {day: '2026-10-28', kind: 'plumbing', commits: 10}, {day: '2026-11-02', kind: 'plumbing', commits: 2}],
  workFiles: [{week: '2026-10-26', file: '.github/workflows/e2e.yml', commits: 6}, {week: '2026-11-02', file: 'tools/ship.sh', commits: 1}]};

test('the week reads the page\'s own 7-day window: the same runs, reds and groups as /admin/testing/e2e', () => {
  const s = weekly(snapshot, monday), w = windowOf(snapshot, '7d', monday);
  assert.equal(s.runs, w.runs);
  assert.equal(s.redRuns, w.redRuns);
  assert.deepEqual(s.byGroup, topSummary(w).byGroup);
  assert.deepEqual([s.runs, s.redRuns, s.reds], [10, 4, 5]);
  assert.deepEqual(s.caught.map(row => row.suite), ['apply']);
  assert.deepEqual(s.idle.map(row => row.suite), ['applyflows', 'quality', 'strategy']);
});

test('prune candidates: red in the snapshot\'s 30 days and never a catch; a suite that caught once (settings, 12 Oct) is not one', () => {
  const s = weekly(snapshot, monday);
  assert.deepEqual(s.prune.map(row => [row.suite, row.reds]), [['strategy', 4], ['applyflows', 2], ['quality', 1]]);
  assert.match(decision(s), /^3 suites red in 30 days without catching a bug: strategy \(4 red, 0\.7 h\), applyflows \(2 red, 0\.2 h\), quality \(1 red, 0\.7 h\)\. Keep, move to a tolerant lane, or retire\?$/);
  assert.equal(decision({...s, prune: []}), null);
});

test('work: the last full calendar week (Monday\'s own commits wait for next week), its plumbing share against 15%, its files', () => {
  const s = weekly(snapshot, monday);
  assert.deepEqual([s.work.week, s.work.total, s.work.counts.plumbing], ['2026-10-26', 40, 10]);
  assert.deepEqual(s.files.map(row => row.file), ['.github/workflows/e2e.yml']);
  assert.match(telegramText(s), /Plumbing 25% of 40 commits in the week of 26 Oct \(over the 15% target\)/);
  assert.match(telegramText(weekly({...snapshot, work: []}, monday)), /No commit read for the week of 26 Oct/);
});

test('Telegram: the verdict first, the decision last, the page and the issue linked; the issue says the same numbers', () => {
  const s = weekly(snapshot, monday), text = telegramText(s, 'https://github.com/GarryOne/jobadabra-web/issues/9');
  const lines = text.split('\n');
  assert.equal(lines[0], '🧪 E2E week to 2 Nov: 4 of 10 runs red (40%)');
  assert.match(text, /Caught a bug: apply\nRed, caught nothing: applyflows \(2\), quality \(1\), strategy \(1\)/);
  assert.match(lines.at(-3), /^Your call: 3 suites red in 30 days/);
  assert.deepEqual(lines.slice(-2), ['https://www.jobadabra.top/admin/testing/e2e', 'https://github.com/GarryOne/jobadabra-web/issues/9']);
  assert.equal(issueTitle(s), 'E2E week · 2026-11-02');
  const body = issueBody(s);
  assert.match(body, /^\*\*4 of 10 e2e runs red \(40%\)\*\* in the 7 days to 2 Nov; 1 of 5 red suites caught a product bug\./);
  assert.match(body, /> \*\*Decision:\*\* 3 suites red in 30 days/);
  assert.match(body, /\| `quality` \| 0 \| 0 \| 1 \| 0 \| 0\.7 h \|/);
  assert.match(body, /\| CI and harness plumbing \| 10 \|/);
  assert.match(telegramText({...s, prune: [], reds: 0, caught: [], idle: []}), /No red suite this week\nNo red suite caught a bug\n[^]*\nNo decision for you this week\./);
});

test('a Telegram message that did not go out turns the run red, after the issue is written (#211, Gitar)', async () => {
  const {deliver} = await import('../../tools/ci-intel/jobs/e2e-weekly.mjs');
  const s = weekly(snapshot, monday), written = [];
  const write = (title, body) => { written.push(title); return 'https://github.com/GarryOne/jobadabra-web/issues/9'; };
  await assert.rejects(deliver(s, {write, tell: async () => ({skipped: 'Telegram answered 401'})}), /did not reach Telegram \(Telegram answered 401\); the issue is at .*issues\/9/);
  assert.deepEqual(written, ['E2E week · 2026-11-02']);
  assert.equal(await deliver(s, {write, tell: async () => ({sent: true})}), 'https://github.com/GarryOne/jobadabra-web/issues/9');
});

const greySnapshot = (since = '2026-10-29') => ({at: monday.toISOString(), lanes: {suites: {
  quality: {lane: 'tolerant', input: 'ai', since, why: 'An unkeyed ask'},
  paused: {lane: 'suspended', input: 'clock', since: '2026-10-28', why: 'Retry flip', returns: 'Three steady nights'},
  gone: {lane: 'retired', since: '2026-10-01', why: 'Removed'}
}}});

test('Grey keeps full rows in the issue and compact suite lines in Telegram', () => {
  const s = weekly(greySnapshot(), new Date('2026-10-30T23:59:00Z'));
  assert.deepEqual(s.grey.rows.map(row => [row.suite, row.age]), [['paused', 2], ['quality', 1]]);
  assert.match(issueBody(s), /quality.*tolerant.*ai.*An unkeyed ask.*2026-10-29.*1 day.*no exit condition yet/);
  assert.match(telegramText(s), /\nquality \(tolerant, 1 day, 0\/0 red\)\n/);
  assert.doesNotMatch(telegramText(s), /no exit condition yet|An unkeyed ask/);
  assert.doesNotMatch(issueBody(s), /not recorded yet|suite × reason/);
  assert.match(issueBody(weekly({}, monday)), /lane registry not read yet/);
});

test('300 detailed Grey suites fit one Telegram message without losing the decision or links', t => {
  const suites = Array.from({length: 300}, (_, i) => `suite-${String(i).padStart(3, '0')}`);
  const why = 'W'.repeat(500), returns = 'R'.repeat(500);
  const s = weekly({lanes: {suites: Object.fromEntries(suites.map(suite => [suite,
    {lane: 'tolerant', since: '2026-10-10', why, returns}]))},
  suiteNights: suites.flatMap(suite => ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
    .map((day, i) => ({suite, day, kind: 'nightly', green: i !== 0})))}, monday);
  const url = 'https://github.com/GarryOne/jobadabra-web/issues/9';
  const text = telegramText(s, url);
  t.diagnostic(`300 Grey suites: ${text.length} Telegram characters`);
  assert.ok(text.length < 4096, `Telegram text has ${text.length} characters`);
  assert.match(text, /\nsuite-000 \(tolerant, 23 days, 1\/7 red\)\n/);
  const shown = text.split('\n').filter(line => /^suite-\d+ \(/.test(line)).length;
  assert.ok(shown > 0 && shown < 300);
  assert.ok(text.includes(`\n…and ${300 - shown} more\n`));
  assert.match(text, /\nYour call: Grey: suite-000 .*keep, fix or retire\?/);
  assert.ok(text.endsWith(`https://www.jobadabra.top/admin/testing/e2e\n${url}`));
  assert.doesNotMatch(text, /W{500}|R{500}|2026-10-26 red/);
  const body = issueBody(s);
  const fullRows = body.split('\n').filter(line => /^suite-\d+ ·/.test(line));
  assert.equal(fullRows.length, 300);
  assert.ok(fullRows.every(line => line.includes(why) && line.includes(returns)));
  assert.match(body, /2026-10-26 red/);

  const busy = {...s, caught: suites.map(suite => ({suite})), idle: suites.map(suite => ({suite, noise: 1, ours: 0, unnamed: 0})),
    prune: suites.map(suite => ({suite, reds: 1, min: 10}))};
  assert.ok(telegramText(busy, url).length < 4096, 'the cap covers scorecard and decision lists too');
});

test('Grey expiry is strictly more than 14 days; it joins prune in ONE owner decision', () => {
  const s = weekly(greySnapshot(), new Date('2026-11-12T23:59:00Z'));
  assert.equal(decision({...s, grey: {...s.grey, rows: s.grey.rows.filter(row => row.suite === 'quality')}}), null, '14 days does not expire');
  const expired = weekly({...snapshot, ...greySnapshot()}, new Date('2026-11-13T00:00:00Z'));
  assert.match(decision(expired), /quality.*15 days grey/);
  assert.match(decision(expired), /keep, fix or retire\?/i);
  assert.match(decision(expired), /without catching a bug/);
  assert.equal((telegramText(expired).match(/Your call:/g) || []).length, 1);
});

test('three calendar nights below a stored main band trigger a decision; gaps, missing bands and recovery do not', () => {
  const nights = ['2026-10-30', '2026-10-31', '2026-11-01'].map((day, i) => ({day, runId: i + 1, suite: 'quality', platform: 'mac', kind: 'nightly', green: true, rates: {agree: 0.6}}));
  const base = {...greySnapshot(), suiteNights: nights, mainBands: {quality: {agree: {lower: 0.8, upper: 0.95}}}};
  const s = weekly(base, monday);
  assert.match(decision(s), /quality.*below main's band 3 nights in a row/);
  assert.match(issueBody(s), /60%.*main.*80%.*95%/);
  assert.equal(decision(weekly({...base, mainBands: {}}, monday)), null);
  assert.equal(decision(weekly({...base, suiteNights: nights.slice(1)}, monday)), null);
  assert.equal(decision(weekly({...base, suiteNights: nights.map((row, i) => ({...row, rates: {agree: i === 2 ? 0.9 : 0.6}}))}, monday)), null);
  assert.equal(decision(weekly({...base, suiteNights: nights.map((row, i) => ({...row, day: i === 0 ? '2026-10-28' : row.day}))}, monday)), null);
});

test('a combined prune/Grey decision asks once; recorded quality rates never invent a suite outcome', () => {
  const s = weekly({...snapshot, ...greySnapshot('2026-10-10'), quality: [{day: '2026-11-01', pairs: 10, within8: 8, over20: 0}]}, monday);
  assert.equal((decision(s).match(/\?/g) || []).length, 1);
  assert.match(issueBody(s), /2026-11-01 result not stored/);
});

test('weekly speed uses thirty days of shared rows, the slowest three, and the strict PR warning', () => {
  const speedRuns = [1, 2, 3].flatMap(runId => ['scheduled', 'pr'].map((kind, j) => ({runId: runId + 10 * j, kind, createdAt: '2026-10-10T12:00:00Z',
    suiteJobs: (kind === 'pr' ? [['interactions', 481]] : [['jobs', 307], ['activityfailures', 194], ['focus', 22], ['updates', 7]])
      .map(([suite, seconds]) => ({suite, seconds}))})));
  const s = weekly({...snapshot, speedRuns}, monday);
  const lines = telegramText(s).split('\n');
  assert.ok(lines.includes('Slowest: jobs 5m07s (3 runs), activityfailures 3m14s (3 runs), focus 22s (3 runs)'));
  assert.ok(lines.includes('PR suites over 8 min: interactions (8m01s, 3 runs)'));
  assert.match(issueBody(s), /Slowest: jobs 5m07s \(3 runs\)/);
  assert.match(telegramText(weekly({...snapshot, speedRuns: speedRuns.map(r => r.kind === 'pr' ? {...r, suiteJobs: [{suite: 'interactions', seconds: 480}]} : r)}, monday)), /PR suites over 8 min: none/);
  assert.doesNotMatch(telegramText(weekly(snapshot, monday)), /Slowest:|PR suites over 8 min:/, 'missing data adds no line');
});

test('a busy week with 300 Grey, scorecard and slow PR suites keeps speed, decision and links under Telegram limit', t => {
  const suites = Array.from({length: 300}, (_, i) => `suite-${String(i).padStart(3, '0')}-${'x'.repeat(60)}`);
  const speedRuns = [1, 2, 3].flatMap(runId => ['scheduled', 'pr'].map((kind, j) => ({runId: runId + j * 10, kind, createdAt: '2026-11-01T12:00:00Z', suiteJobs: suites.map(suite => ({suite, seconds: 481}))})));
  const lanes = {suites: Object.fromEntries(suites.map(suite => [suite, {lane: 'tolerant', since: '2026-10-10'}]))};
  const s = weekly({...snapshot, speedRuns, lanes}, monday), url = 'https://github.com/GarryOne/jobadabra-web/issues/99999';
  const busy = {...s, caught: suites.map(suite => ({suite})), idle: suites.map(suite => ({suite, noise: 1, ours: 0, unnamed: 0})), prune: suites.map(suite => ({suite, reds: 1, min: 10}))};
  const text = telegramText(busy, url);
  t.diagnostic(`Busy speed week: ${text.length} Telegram characters`);
  assert.ok(text.length < 4096);
  assert.match(text, /Slowest:/);
  assert.match(text, /PR suites over 8 min:/);
  assert.match(text, /Your call:/);
  assert.ok(text.endsWith(url));
});
