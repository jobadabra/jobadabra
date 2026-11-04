// What the window itself can tell happened while the person was away (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md, 2/2): a strong match from a scheduled search,
// Gmail updates, a recruiter waiting. Each claim is true or not made: guard for renderer/notify-detect.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchWhileAway, recruiterWaiting, updatesWhileAway, wasAway} from '../../../renderer/notify-detect.js';

const MIN = 60 * 1000;
const T0 = Date.parse('2026-11-02T09:00:00Z');
const iso = ms => new Date(ms).toISOString();
const away = {seenAt: iso(T0), backAt: iso(T0 + 600 * MIN)};   // gone 09:00, back 19:00
const search = (extra = {}) => ({kind: 'search', trigger: 'schedule', ok: true, startedAt: iso(T0 + 100 * MIN), endedAt: iso(T0 + 110 * MIN), ...extra});
const job = (fit, extra = {}) => ({title: `Role ${fit}`, company: 'Acme', fit, first_seen_at: iso(T0 + 105 * MIN), ...extra});   // first seen while the run was running (the store writes a full UTC timestamp: src/store.py _now)

test('match: a scheduled search that ended while away found a job at 85 or better -> the best fit and when the check ran', () => {
  const found = matchWhileAway({...away, runs: [search()], jobs: [job(72), job(91), job(86)]});
  assert.equal(found.fit, 91);
  assert.equal(found.title, 'Role 91');
  assert.equal(found.endedAt, iso(T0 + 110 * MIN));
});

test('match: no claim when the search was run by the person, failed, ended before they left or after they came back, or nothing reached 85', () => {
  const jobs = [job(91)];
  assert.ok(matchWhileAway({...away, runs: [search()], jobs}), 'positive control');
  assert.equal(matchWhileAway({...away, runs: [search({trigger: 'you'})], jobs}), null, 'they pressed Find jobs themselves');
  assert.equal(matchWhileAway({...away, runs: [search({ok: false})], jobs}), null, 'failed');
  assert.equal(matchWhileAway({...away, runs: [search({endedAt: iso(T0 - MIN)})], jobs}), null, 'ended before they left');
  assert.equal(matchWhileAway({...away, runs: [search({endedAt: iso(T0 + 700 * MIN)})], jobs}), null, 'ended after they came back');
  assert.equal(matchWhileAway({...away, runs: [search()], jobs: [job(84)]}), null, 'under 85');
  assert.equal(matchWhileAway({...away, runs: [search()], jobs: [job(91, {first_seen_at: '2026-11-01T09:00:00+00:00'})]}), null, 'an older job is not this run\'s news');
  assert.equal(matchWhileAway({...away, runs: [search()], jobs: [job(91, {first_seen_at: iso(T0 + 50 * MIN)})]}), null, 'Gitar on #3022: found earlier the SAME day (a search the person watched) is not this scheduled run\'s news');
  assert.equal(matchWhileAway({...away, runs: [search()], jobs: [job(91, {first_seen_at: '2026-11-02'})]}), null, 'a date alone cannot prove it came after the run started: no claim');
  assert.equal(matchWhileAway({seenAt: '', backAt: '', runs: [search()], jobs}), null, 'no stamps (an install from before this version)');
});

test('updates: the Gmail check that ended while away found N updates (the count the notification uses); none, or a failed check: no claim', () => {
  const mail = (extra = {}) => ({kind: 'mail', ok: true, endedAt: iso(T0 + 200 * MIN), updates: ['Interview invite from Acme', 'Applied: Beta'], ...extra});
  assert.equal(updatesWhileAway({...away, runs: [mail()]}).count, 2);
  assert.equal(updatesWhileAway({...away, runs: [mail({updates: undefined, result: '3 updates found'})]}).count, 3);
  assert.equal(updatesWhileAway({...away, runs: [mail({updates: []})]}), null);
  assert.equal(updatesWhileAway({...away, runs: [mail({ok: false})]}), null);
  assert.equal(updatesWhileAway({...away, runs: [mail({endedAt: iso(T0 - MIN)})]}), null, 'before they left');
});

test('recruiter: a Focus card "Reply today" (kind reply) is a recruiter waiting; any other card is not', () => {
  assert.deepEqual(recruiterWaiting([{kind: 'book'}, {kind: 'reply', company: 'Acme'}, {kind: 'reply', company: 'Beta'}]), {count: 2, company: 'Acme'});
  assert.equal(recruiterWaiting([{kind: 'book'}, {kind: 'prepare'}]), null);
  assert.equal(recruiterWaiting(null), null);
});

test('away: only something that ended after the person left and before they came back', () => {
  const left = iso(T0), back = iso(T0 + 60 * MIN);
  assert.equal(wasAway(left, back, iso(T0 + 5 * MIN)), true, 'positive control');
  assert.equal(wasAway(left, back, iso(T0 - 5 * MIN)), false, 'ended before they left');
  assert.equal(wasAway(left, back, iso(T0 + 61 * MIN)), false, 'ended after they came back: they were there');
});

test('nothing is claimed without both stamps (an install from before this version), when they have not come back, or without an end time', () => {
  const left = iso(T0), back = iso(T0 + 60 * MIN), ended = iso(T0 + 5 * MIN);
  assert.equal(wasAway('', back, ended), false);
  assert.equal(wasAway(left, '', ended), false);
  assert.equal(wasAway(left, iso(T0 - MIN), ended), false, 'the last stamp is a leave: they are away right now, not back');
  assert.equal(wasAway(left, back, ''), false);
});
