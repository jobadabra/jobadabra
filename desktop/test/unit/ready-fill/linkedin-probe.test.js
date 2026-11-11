// Guard: privacy — the LinkedIn session sent to the cloud probe must never reach a log or a result, and a doubt must end as `no` (LinkedIn stays Mac-only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {cookiesOf, kindOfPath, verdictOf, probeOne, probeNight, SEARCH, SIGNED_CARDS, GUEST, NAV} from '../../../ready-fill/linkedin-probe.mjs';
import {TASKS} from '../../../ready-fill/night.mjs';

const SECRET = 'AQEDAR-secret-li-at-value', JS = '"ajax:12345"';

test('the night knows the linkedin task and still refuses a typo', () => {
  assert.ok(TASKS.includes('linkedin'));
  assert.ok(!TASKS.includes('linkedin '));
});

test('cookiesOf keeps only li_at and JSESSIONID, li_at required, one printable token each', () => {
  assert.deepEqual(cookiesOf({li_at: SECRET, JSESSIONID: JS, other: 'x'}).map(c => c.name), ['li_at', 'JSESSIONID']);
  assert.equal(cookiesOf({JSESSIONID: JS}), null);
  assert.equal(cookiesOf({li_at: 'has space'}), null);
  assert.equal(cookiesOf(null), null);
});

test('verdict is go only for 200 + the search page + the signed-in page + signed-in cards; every doubt is no', () => {
  const ok = {status: 200, path: '/jobs/search/', cards: 7, nav: 1, guest: 0};
  assert.deepEqual(verdictOf(ok), {go: true, word: 'ok'});
  assert.deepEqual(verdictOf({...ok, cards: 0}), {go: false, word: 'nocards'});
  assert.deepEqual(verdictOf({...ok, guest: 3}), {go: false, word: 'guest'}, 'the public page with cards at the same address is not an answer');
  assert.deepEqual(verdictOf({...ok, nav: 0}), {go: false, word: 'unclear'});
  assert.deepEqual(verdictOf({...ok, limited: true}), {go: false, word: 'limited'}, 'a 429 on any document answer');
  for (const status of [401, 403, 429, 999]) assert.equal(verdictOf({...ok, status}).go, false);
  assert.deepEqual(verdictOf({...ok, path: '/authwall'}), {go: false, word: 'login'});
  assert.deepEqual(verdictOf({...ok, path: '/checkpoint/challenge/x'}), {go: false, word: 'check'});
  assert.deepEqual(verdictOf({...ok, status: 302, path: '/uas/login', cards: 0}), {go: false, word: 'login'});
  assert.deepEqual(verdictOf({...ok, path: '/feed/'}), {go: false, word: 'other'});
  assert.deepEqual(verdictOf({...ok, status: 500}), {go: false, word: 'error'});
  assert.equal(kindOfPath('/jobs/search/'), 'results');
});

// A fake Playwright: records the cookies it was given, answers each document status in turn, ends on `landed`, counts by selector, and closes.
const fake = ({statuses = [200], landed = '/jobs/search/', cards = 5, nav = 1, guest = 0, failGoto = false} = {}) => {
  const state = {closed: false, cookies: null, visits: [], launch: null};
  const page = {on: (event, fn) => { page.fn = fn; }, goto: async url => { state.visits.push(url); if (failGoto) throw new Error(`boom ${SECRET}`); for (const status of statuses) page.fn({request: () => ({resourceType: () => 'document'}), status: () => status}); },
    url: () => `https://www.linkedin.com${landed}?x=1`, locator: selector => ({count: async () => (selector === SIGNED_CARDS ? cards : selector === NAV ? nav : selector === GUEST ? guest : 0)})};
  const context = {addCookies: async list => { state.cookies = list; }, newPage: async () => page};
  return {state, chromium: {launch: async options => { state.launch = options; return {newContext: async () => context, close: async () => { state.closed = true; }}; }}};
};
const quick = {wait: async () => {}};

test('probeOne reads ONE page, never retries, and closes the browser', async () => {
  const f = fake();
  const read = await probeOne({chromium: f.chromium, session: {li_at: SECRET}, ...quick});
  assert.deepEqual([read.status, read.path, read.cards, read.go, read.word], [200, '/jobs/search/', 5, true, 'ok']);
  assert.deepEqual(f.state.visits, [SEARCH]);
  assert.equal(f.state.closed, true);
  assert.equal(f.state.launch.timeout, 90000);
});

test('a guest page with job cards is NOT a go, a redirect then 200 is read as 200, a 429 anywhere is limited', async () => {
  assert.equal((await probeOne({chromium: fake({guest: 9, nav: 0}).chromium, session: {li_at: SECRET}, ...quick})).word, 'guest');
  assert.equal((await probeOne({chromium: fake({nav: 0}).chromium, session: {li_at: SECRET}, ...quick})).word, 'unclear');
  assert.equal((await probeOne({chromium: fake({statuses: [302, 200]}).chromium, session: {li_at: SECRET}, ...quick})).go, true);
  assert.equal((await probeOne({chromium: fake({statuses: [429, 200]}).chromium, session: {li_at: SECRET}, ...quick})).word, 'limited');
});

test('a check page or a failed load is no, and the browser still closes', async () => {
  assert.equal((await probeOne({chromium: fake({landed: '/checkpoint/x'}).chromium, session: {li_at: SECRET}, ...quick})).go, false);
  const failing = fake({failGoto: true});
  assert.equal((await probeOne({chromium: failing.chromium, session: {li_at: SECRET}, ...quick})).word, 'error');
  assert.equal(failing.state.closed, true);
});

test('the session never reaches the log or the result body', async () => {
  const lines = [], bodies = [];
  const tell = {result: async body => { bodies.push(body); return {ok: true}; }, costMicro: ms => ms};
  const f = fake({failGoto: true});
  await probeNight({batch: {jobs: [{id: 'probe', url: SEARCH}], linkedin: {li_at: SECRET, JSESSIONID: JS}}, chromium: f.chromium, tell, log: (what, data) => lines.push(JSON.stringify([what, data])),
    probe: opts => probeOne({...opts, wait: async () => {}})});
  const all = JSON.stringify([lines, bodies]);
  assert.ok(!all.includes('secret') && !all.includes('ajax'), 'no session value anywhere');
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].task, 'linkedin');
  assert.equal(bodies[0].read.word, 'error');
});
