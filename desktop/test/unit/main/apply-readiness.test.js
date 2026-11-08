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

test('a match with an unjudged question is not stored: the next check asks again instead of freezing "answers not checked"', async () => {
  assert.equal(storable({...SIMPLE, match: {missing: [], unjudged: 2}}), false);
  const {readiness, calls} = make({match: async asked => Object.fromEntries(asked.map(item => [item.url, {missing: [], unjudged: 1}]))});
  await readiness.applyReadiness({...JOB, kit: true});
  await readiness.settle([{url: JOB.url, questions: SIMPLE.questions}]);
  assert.equal(calls.store.some(([, method]) => method === 'update'), false);
});

test('a stored form that needed details is matched again from its questions, so saving the detail clears it', async () => {
  let answer = {missing: [{kind: 'detail', label: 'Phone'}], unjudged: 0};
  const {readiness, calls} = make({match: async asked => Object.fromEntries(asked.map(item => [item.url, answer]))});
  await readiness.applyReadiness({...JOB, kit: true});
  await readiness.settle([{url: JOB.url, questions: SIMPLE.questions}]);
  answer = {missing: [], unjudged: 0};   // the person saved the phone number
  const again = await readiness.storedCheck({...JOB, kit: true});
  assert.deepEqual(again.match.missing, []);
  assert.equal(calls.read, 1, 'the form was not read again');
  assert.equal((await readiness.storedCheck({...JOB, kit: true})).match.missing.length, 0, 'and the new match is what is stored');
});

test('a Stop while the kit drafts ends the check before the browser opens; a kit that failed still reads the form', async () => {
  let release;
  const calls = {read: 0};
  const slow = createReadiness({storage: {}, prepareKit: () => new Promise(done => { release = () => done({ok: true}); }), readForm: async () => { calls.read += 1; return SIMPLE; },
    call: async () => ({id: 'r1', apply_readiness: ''})});
  const pending = slow.applyReadiness(JOB);
  slow.cancel();
  release();
  assert.deepEqual([(await pending).check, (await pending).cancelled], [null, true]);
  assert.equal(calls.read, 0);
  const failed = createReadiness({storage: {}, prepareKit: async () => ({ok: false, error: 'no posting'}), readForm: async () => { calls.read += 1; return SIMPLE; }, call: async () => null});
  const done = await failed.applyReadiness(JOB);
  assert.deepEqual([done.kit.ok, done.check.simple, calls.read], [false, true, 1], 'a kit that failed still lets the form be read (red main after #3573)');
  const gated = createReadiness({storage: {}, prepareKit: async () => ({ok: false, refused: true, needsNotion: true}), readForm: async () => { calls.read += 1; return SIMPLE; }, call: async () => null});
  assert.equal((await gated.applyReadiness(JOB)).check, null);
  assert.equal(calls.read, 1, 'a gate (Notion, allowance, no AI) opens no browser (Gitar on #3578)');
  let stop;
  const held = createReadiness({storage: {}, prepareKit: async () => ({ok: false, stopped: true, error: 'no posting'}), readForm: () => new Promise(done => { stop = () => done(null); }), call: async () => null});
  const cut = held.applyReadiness(JOB);
  await new Promise(setImmediate);
  held.cancel(); stop();
  assert.equal((await cut).cancelled, true, 'a Stop during the read of a job whose kit failed is a Stop, not "Couldn\'t read"');
});

test('the Jobs page shows why a kit could not be drafted, passes the Notion gate up, and marks a drafted kit', async () => {
  const {readThroughStep} = await import('../../../renderer/apply-readiness-read.js');
  const via = done => ({applyReadiness: async () => done});
  assert.deepEqual(await readThroughStep(via({kit: {ok: false, error: 'needs AI'}, check: null}), JOB), {unreadable: true, why: 'kit', kitError: 'needs AI'});
  assert.equal((await readThroughStep(via({kit: {ok: false, needsNotion: true, reason: 'connect Notion'}}), JOB)).kitError, 'connect Notion');
  assert.equal(await readThroughStep(via({kit: {ok: false, error: 'no posting'}, check: null, cancelled: true}), JOB), null, 'a Stop leaves the job Not checked (review of #3578)');
  const {chipOf} = await import('../../../renderer/apply-triage-pick.js');
  const {t} = await import('../../../i18n/index.js');
  assert.equal(chipOf({unreadable: true, why: 'kit'}).detail, t('helperTail.triageKit'), 'the chip says the kit could not be prepared, not that the page did not load');
  assert.deepEqual(await readThroughStep(via({kit: {ok: false, error: 'no posting'}, check: SIMPLE, stored: false}), {...JOB}), {...SIMPLE, stored: false}, 'a read made despite the kit shows the read');
  const job = {...JOB};
  assert.deepEqual(await readThroughStep(via({kit: {ok: true}, check: SIMPLE, stored: true}), job), {...SIMPLE, stored: true});
  assert.equal(job.kit, true, 'the next check does not draft it again');
  assert.equal(await readThroughStep(via({kit: {ok: true}, check: null}), {...JOB, code: ''}), null);
});
