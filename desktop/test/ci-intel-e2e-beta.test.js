// Suites green vs red in every beta run on /admin/testing/e2e (owner, 1 Nov 2026): the row is cleaned, merged and drawn from the snapshot only; counts, a released marker, words for an empty range.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {betaCard, betaData, betaRuns, betaSummary, cleanBetaRun} from '../../tools/ci-intel/lib/e2e-beta.mjs';
import {esc} from '../../tools/ci-intel/lib/html.mjs';

const now = new Date('2026-11-01T12:00:00Z');
const beta = (runId, createdAt, green, red, grey = 0, extra = {}) => ({runId, createdAt, sha: 'abcdef1234567', conclusion: red ? 'failure' : 'success', green, red, grey, released: false,
  redSuites: Array.from({length: red}, (_, i) => `Mac + Linux · suite${i}`), ...extra});
const rows = [beta(1, '2026-10-31T23:14:00Z', 62, 0, 0, {released: true}), beta(2, '2026-10-31T10:00:00Z', 61, 1), beta(3, '2026-10-30T03:00:00Z', 0, 0, 2), beta(4, '2026-10-29T03:00:00Z', 30, 8, 24),
  beta(5, '2026-10-20T03:00:00Z', 50, 12), beta(6, '2026-10-30T05:00:00Z', 5, 0, 57, {conclusion: 'cancelled'})];
const snapshot = {schema: 2, at: '2026-11-01T11:41:00Z', days: [], fails: [], latest: [], betaRuns: rows};


test('a row is cleaned on both ends: bad shapes are dropped, names bounded, the commit shortened, 30 days kept', () => {
  assert.equal(cleanBetaRun(rows[0], now).sha, 'abcdef1');
  for (const bad of [{...rows[0], runId: 0}, {...rows[0], green: -1}, {...rows[0], red: 1.5}, {...rows[0], conclusion: 'skipped'}, {...rows[0], released: 'yes'}, {...rows[0], sha: 'not a sha'},
    {...rows[0], createdAt: '2026-09-01T00:00:00Z'}, {...rows[0], createdAt: '2026-11-03T00:00:00Z'}, null]) assert.equal(cleanBetaRun(bad, now), null, JSON.stringify(bad));
  assert.deepEqual(cleanBetaRun({...rows[1], redSuites: ['x'.repeat(200), 5, '']}, now).redSuites, ['x'.repeat(80)]);
});

test('betaData merges by run (a re-read replaces it), expires after 30 days, and an omitted field keeps the last rows', () => {
  const first = betaData({}, {betaRuns: [rows[0], rows[1], {...rows[0], runId: 9, createdAt: '2026-09-01T00:00:00Z'}, {runId: 'x'}]}, now);
  assert.deepEqual(first.betaRuns.map(row => row.runId), [1, 2]);
  const again = betaData(first, {betaRuns: [{...rows[1], green: 62, red: 0, conclusion: 'success', redSuites: [], released: true}]}, now);
  assert.deepEqual(again.betaRuns.map(row => [row.runId, row.green, row.released]), [[1, 62, true], [2, 62, true]], 'newest first; the re-sent run replaced its row');
  assert.deepEqual(betaData(again, {}, now).betaRuns.length, 2, 'nothing sent keeps what was stored');
  assert.deepEqual(betaData(again, {}, new Date('2026-12-05T00:00:00Z')).betaRuns, [], 'expired rows go');
});

test('the range is the page\'s UTC days, oldest first; the four tiles count betas that ran their suites (a cancelled run shows no verdict)', () => {
  assert.deepEqual(betaRuns(snapshot, {days: 7, now}).map(row => row.runId), [4, 3, 6, 2, 1]);
  assert.deepEqual(betaRuns(snapshot, {days: 30, now}).map(row => row.runId), [5, 4, 3, 6, 2, 1]);
  assert.deepEqual(betaSummary(betaRuns(snapshot, {days: 7, now})), {runs: 5, released: 1, ran: 3, zeroRed: 1, oneRed: 1});
});

test('the card: one bar per run with green, red and grey counts, a ✓ on the released one, the red count under the bar, a table with the run links and red suites', () => {
  const html = betaCard(snapshot, {days: 7, now, repo: 'GarryOne/jobadabra', scopeName: 'Last 7 days'});
  assert.equal((html.match(/class="bcol/g) || []).length, 5);
  assert.equal((html.match(/<span class="bmk">✓<\/span>/g) || []).length, 1, 'only run 1 was released');
  assert.match(html, /62 suites green · 0 red\nreleased/);
  assert.match(html, /61 suites green · 1 red\nRed: Mac \+ Linux · suite0/);
  assert.ok(html.includes(esc('0 suites green · 0 red · 2 didn\'t run or not finished')), 'grey = did not run or not finished');
  assert.ok(html.includes(esc('30 suites green · 8 red · 24 didn\'t run or not finished')));
  assert.match(html, /<span class="bnum">8<\/span>/);
  assert.match(html, /Zero red<\/span><b>1 of 3<\/b>[^]*?Exactly one red<\/span><b>1 of 3<\/b>/);
  assert.match(html, /href="https:\/\/github\.com\/GarryOne\/jobadabra\/actions\/runs\/2"/);
  assert.equal((html.match(/class="bcol newday"/g) || []).length, 2, 'a gap before the 30th and the 31st; the first bar needs none');
  assert.equal((html.match(/<b>(29|30|31)<\/b>/g) || []).length, 3, 'the date sits under the first bar of each day only');
  assert.match(html, /<th>Red suites<\/th>/);
  assert.doesNotMatch(html, /runs\/5"/, 'the 20 Oct run is outside the 7-day range');
  assert.match(betaCard(snapshot, {days: 30, now}), /runs\/5"/);
});

test('an empty range and a snapshot without beta rows each say so in words', () => {
  assert.match(betaCard({...snapshot, betaRuns: []}, {days: 7, now}), /No beta run in this range/);
  assert.match(betaCard({...snapshot, betaRuns: [rows[4]]}, {days: 7, now}), /No beta run in this range/);
  assert.match(betaCard({...snapshot, betaRuns: undefined}, {days: 7, now}), /Not collected yet/);
  assert.match(betaCard(null, {days: 7, now}), /Not collected yet/);
});
