// Every job count on the Jobs page agrees: the counters, the tooltip and the Find jobs card read one definition (jobCounts in renderer/jobs-view.js).
// 18 Oct 2026: a search said "206 Listed · 203 Scored" over "351 Total matches" because the card counted the loaded (cut) list.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {jobCounts} from '../../../renderer/jobs-view.js';
import {findCard} from '../../../renderer/find-card-model.js';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const row = (id, extra = {}) => ({id, url: `https://x.test/${id}`, company: `Co ${id}`, status: 'unreviewed', fit: null, first_seen_at: '2026-09-01', ...extra});
// The store has 12 rows: the list loaded 9 of them (cut), 3 matches (2 scored, one high fit, one new this week) are not loaded.
const loaded = [
  row(1, {fit: 90}), row(2, {fit: 75, first_seen_at: '2026-10-17'}), row(3, {fit: 40}), row(4), row(5, {fit: 55, status: 'dismissed'}),
  row(6, {fit: 80, status: 'applied'}), row(7, {fit: 60, status: 'saved'}),
  row(8, {origin: 'inbound', stage: 'Screening'}), row(9, {expired: true, fit: 30}),
];
const data = {jobs: loaded, total: 12, scored_beyond: 2, high_beyond: 1, week_beyond: 1};

test('the counters count job matches, loaded or not, once', () => {
  const count = jobCounts(data, NOW);
  // matches = loaded rows that are not applications or inbound (7: 1,2,3,4,5,7,9) + the 3 not loaded
  assert.equal(count.total, 10);
  assert.equal(count.scored, 6 + 2, 'loaded matches with a fit (1,2,3,5,7,9) + the 2 scored ones not loaded');
  assert.equal(count.week, 2, 'row 2 and the one not loaded');
});

test('every count is within the total and the card repeats the counters', () => {
  const count = jobCounts(data, NOW);
  assert.ok(count.scored <= count.total && count.week <= count.total);
  const card = findCard({finishedHere: true, last: {ok: true}, lastSearchAt: 'x', listed: count.total});
  assert.equal(card.listed, count.total, 'a run without a counts line falls back to the list count, the same one');
});

// The owner's list: seven rows, none a match and none a sent application, so every tile but Inbound says 0.
const tracked = Array.from({length: 7}, (_, index) => row(index + 1, {status: 'applied', origin: 'inbound', stage: 'Reply received'}));
const cardFor = (data, extra = {}) => { const count = jobCounts(data, NOW); return findCard({listed: count.total, anyJob: count.anyJob, ...extra}); };

test('tracked jobs and no search yet are not the empty first run: the big Find jobs card stays away (owner, 4 Nov 2026)', () => {
  assert.equal(jobCounts({jobs: tracked, total: tracked.length}, NOW).total, 0, 'none of them is a match');
  const card = cardFor({jobs: tracked, total: tracked.length});
  assert.equal(card.state, 'none', 'the compact card, which the Applied and Inbound lists hide');
  assert.equal(cardFor({jobs: []}).state, 'empty', 'no job at all is still the first run');
  assert.equal(cardFor(undefined).state, 'empty');
});

test('the small card is one card whoever has jobs: nothing about it depends on a search having run (owner, 5 Nov 2026)', () => {
  const matches = {jobs: [row(1, {fit: 80}), row(2, {fit: 60})], total: 2};
  assert.deepEqual(cardFor(matches), {state: 'none'}, 'matches and no recorded search');
  assert.deepEqual(cardFor(matches, {lastSearchAt: '2026-10-01'}), {state: 'none'});
  assert.deepEqual(cardFor({jobs: tracked, total: tracked.length}), {state: 'none'}, 'tracked jobs read the same card');
});

test('an old failed search never covers a list of tracked jobs, as it never covers a list of matches (the same cause, the class)', () => {
  const last = {ok: false, problem: 'No AI credit'};
  assert.equal(cardFor({jobs: tracked, total: tracked.length}, {last, lastSearchAt: '2026-10-01'}).state, 'none');
  assert.equal(cardFor({jobs: []}, {last, lastSearchAt: '2026-10-01'}).state, 'failed', 'with no job at all it is still the news');
  assert.equal(cardFor({jobs: tracked, total: tracked.length}, {last, finishedHere: true}).state, 'failed', 'a search that failed just now is news on any list');
});

test('a list that is not cut has nothing beyond: total is the matches', () => {
  const count = jobCounts({jobs: loaded, total: loaded.length}, NOW);
  assert.equal(count.total, 7);
  assert.equal(jobCounts({jobs: []}, NOW).total, 0);
  assert.equal(jobCounts(undefined, NOW).total, 0);
});

test('the Find jobs card reads jobCounts, never the loaded list', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../../renderer/pages/jobs-find.js', import.meta.url), 'utf8');
  assert.match(source, /jobCounts\(/);
  assert.doesNotMatch(source, /jobs\.length|jobs\.filter/);
  assert.match(source, /anyJob: [^,]*counts\.anyJob/, 'the card is told about tracked jobs: a test of the model alone would stay green without this line');
});
