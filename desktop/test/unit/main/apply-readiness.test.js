// Apply readiness (R1): the one step that drafts a kit when missing, then takes the stored form check or reads the form once, and stores what is worth keeping on the job's record.
// Fake store call and fake browser: nothing touches the person's data or a real browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAX_CHARS, createReadiness, isFresh, pack, storable, unpack} from '../../../lib/apply-readiness.js';

const JOB = {url: 'https://jobs.example/a', code: 'ab12', title: 'SRE', kit: false, posted_at: '2026-11-01'};
const SIMPLE = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: true, simple: true, why: 'a simple form', questions: ['Notice period', 'Phone']};
const NOW = new Date('2026-11-07T10:00:00Z');

function make({record = {id: 'r1', apply_readiness: ''}, read = SIMPLE, match = async asked => Object.fromEntries(asked.map(item => [item.url, {missing: [], unjudged: 0}]))} = {}) {
  const calls = {kit: [], read: 0, store: []};
  const readiness = createReadiness({storage: {}, clock: () => NOW,
    prepareKit: async (code, name) => { calls.kit.push([code, name]); return {ok: true}; },
    readForm: async () => { calls.read += 1; return read; }, match,
    call: async (_, entity, method, kwargs) => { calls.store.push([entity, method, kwargs]); if (method === 'get') return record; record = {...record, ...kwargs.fields}; return record; }});
  return {readiness, calls, record: () => record};
}

test('pack and unpack round trip; a text that is not ours is null; another posting is not fresh', () => {
  const text = pack({...SIMPLE, match: {missing: [{kind: 'detail', label: 'Phone'}], unjudged: 0}}, {posted: '2026-11-01', now: NOW});
  const entry = unpack(text);
  assert.deepEqual(entry.read.match.missing, [{kind: 'detail', label: 'Phone'}]);
  assert.equal(isFresh(entry, JOB), true);
  assert.equal(isFresh(entry, {...JOB, posted_at: '2026-11-05'}), false, 'a reposted posting is read again');
  for (const bad of ['', 'x', '{"v":2,"read":{}}', null]) assert.equal(unpack(bad), null);
});

test('a stored check stays under the Notion text limit: questions go first, then the match is cut', () => {
  const long = Array.from({length: 30}, (_, index) => `A required question number ${index} that is quite long ${'x'.repeat(60)}`);
  const text = pack({...SIMPLE, questions: long, match: {missing: long.map(label => ({kind: 'answer', label})), unjudged: 0}}, {now: NOW});
  assert.ok(text.length > 0 && text.length <= MAX_CHARS, `${text.length}`);
  assert.equal(unpack(text).read.questions, undefined);
});

test('unreadable reads and unmatched simple forms are never stored', () => {
  assert.equal(storable({unreadable: true, why: 'timeout'}), false);
  assert.equal(storable(null), false);
  assert.equal(storable(SIMPLE), false, 'questions not matched yet');
  assert.equal(storable({...SIMPLE, match: {missing: [], unjudged: 0}}), true);
  assert.equal(storable({...SIMPLE, questions: []}), true);
  assert.equal(storable({simple: false, captcha: true}), true);
});

test('a job without a kit gets one, and a fresh read is waiting for the check\'s one match', async () => {
  const {readiness, calls} = make();
  const done = await readiness.applyReadiness(JOB);
  assert.deepEqual(calls.kit, [['ab12', 'SRE']]);
  assert.equal(done.stored, false);
  assert.equal(calls.store.some(([, method]) => method === 'update'), false, 'a simple form is stored after its match, not before');
});

test('the match settles the waiting form and stores it with its match; the next check takes it from the store', async () => {
  const {readiness, calls, record} = make({match: async asked => Object.fromEntries(asked.map(item => [item.url, {missing: [{kind: 'detail', label: 'Phone'}], unjudged: 0}]))});
  await readiness.applyReadiness({...JOB, kit: true});
  const found = await readiness.settle([{url: JOB.url, questions: SIMPLE.questions}]);
  assert.equal(found[JOB.url].missing[0].label, 'Phone');
  assert.ok(unpack(record().apply_readiness));
  const again = await readiness.applyReadiness({...JOB, kit: true});
  assert.deepEqual([again.stored, calls.read, again.check.match.missing[0].label], [true, 1, 'Phone']);
  assert.deepEqual(calls.kit, [], 'a job with a kit drafts none');
});

test('a form that is not simple is stored at once; a reposted posting reads again', async () => {
  const {readiness, calls} = make({read: {simple: false, captcha: true, eligible: true}});
  await readiness.applyReadiness({...JOB, kit: true});
  assert.equal((await readiness.applyReadiness({...JOB, kit: true})).stored, true);
  await readiness.applyReadiness({...JOB, kit: true, posted_at: '2026-11-06'});
  assert.equal(calls.read, 2);
});

test('an unreadable read is returned and stored nowhere; a failed match stores nothing', async () => {
  const unreadable = make({read: {unreadable: true, why: 'timeout'}});
  assert.equal((await unreadable.readiness.applyReadiness({...JOB, kit: true})).check.unreadable, true);
  assert.equal(unreadable.calls.store.some(([, method]) => method === 'update'), false);
  const failing = make({match: async () => { throw new Error('ai busy'); }});
  await failing.readiness.applyReadiness({...JOB, kit: true});
  assert.deepEqual(await failing.readiness.settle([{url: JOB.url, questions: SIMPLE.questions}]), {});
  assert.equal(failing.calls.store.some(([, method]) => method === 'update'), false);
});

test('no Applications row yet: nothing is stored and nothing throws', async () => {
  const {readiness, calls} = make({record: null, read: {simple: false}});
  await readiness.applyReadiness({...JOB, kit: true});
  assert.equal(calls.store.some(([, method]) => method === 'update'), false);
});
