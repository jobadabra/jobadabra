// The controller's side of the cloud hand-over (lib/background-apply-cloud.js, cs 4/4): over the real store, which items the cloud may hold, the move of one, and the site's outcome written back with its mail and
// its words. Guard: safety (an item sent is never acted on by the Mac again; a receipt is never overwritten).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyStore} from '../../../lib/background-apply-store.js';
import {createCloudSide} from '../../../lib/background-apply-cloud.js';

const config = {mode: 'auto', chosenAt: '2026-10-27T10:00:00Z', autoConfirmedAt: '2026-10-27T10:00:01Z', auto: {waitMin: 0}};
function rig() {
  let id = 0;
  const apps = new Map(), sections = new Map(), events = [], notices = [], mails = [], away = [], cached = [], closed = [];
  const call = async (_s, entity, method, args) => {
    if (entity === 'applications') {
      if (method === 'get') return apps.get(args.url) || null;
      if (method === 'section') return sections.get(`${args.app_id}:${args.name}`) || '';
      if (method === 'set_section') { sections.set(`${args.app_id}:${args.name}`, args.markdown); return null; }
    }
    if (entity === 'events' && method === 'list') return events.filter(e => !args.kind || e.kind === args.kind);
    if (entity === 'events' && method === 'add') { const row = {...args, id: `e${++id}`}; events.push(row); return row; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  const store = createBackgroundApplyStore({}, {call, now: () => 1, realNow: () => 1, uuid: () => `attempt-${++id}`});
  const make = (name, mode = 'auto') => { const job = {id: `job-${name}`, url: `https://jobs.example.test/${name}`, stage: 'Kit ready', company: 'Fictional'}; apps.set(job.url, job); sections.set(`${job.id}:📝 Application kit`, '```json\n{"eligible":true,"answers":[]}\n```'); return {job, mode}; };
  const records = new Map();
  const terminals = {list: () => [...records.values()]};
  const side = createCloudSide({store, terminals, serial: work => work(), cache: (item, state) => cached.push([item.id, state.state]), itemFor: session => records.get(session) || null, closeSession: async session => { closed.push(session); return true; },
    notify: (title, body, target, kind) => notices.push([kind, session(target)]), tellAway: (item, note) => away.push([item.id, note]), applied: () => ({add: row => mails.push(row.id)}), log: () => {}, now: () => 1});
  const session = target => target?.session;
  const add = async (name, mode = 'auto') => { const {job} = make(name); const row = await store.queue(job.url, `s-${name}`, mode, {...config, mode}); records.set(row.session, {id: row.session, url: job.url, title: `Job ${name}`, company: 'Fictional', background: {mode}}); return row; };
  return {store, side, add, notices, mails, away, cached, closed, records, apps};
}

test('only Full automation items before their press are candidates; a sent one stays one for the next send', async () => {
  const r = rig();
  const auto = await r.add('a'), fill = await r.add('f', 'fill'), stopped = await r.add('s');
  await r.store.handoff(r.records.get(stopped.session).url, stopped.session, '', 'stopped');
  assert.deepEqual((await r.side.candidates()).map(entry => entry.session), [auto.session]);
  assert.equal((await r.side.send(auto.session)).state, 'cloud');
  assert.deepEqual((await r.side.candidates()).map(entry => [entry.session, entry.state.state]), [[auto.session, 'cloud']]);
  assert.equal(await r.side.send(fill.session), null, 'a Fill item never goes');
  assert.deepEqual(r.cached, [[auto.session, 'cloud']], 'the Sessions record follows the store');
});

test('a receipt from the cloud: the item\'s end, the applied mail; a hand-off: the person is told, once, in plain words', async () => {
  const r = rig();
  const a = await r.add('a'), b = await r.add('b'), c = await r.add('c');
  for (const row of [a, b, c]) await r.side.send(row.session);
  assert.equal((await r.side.take(a.session, {state: 'submitted', attempt: 'att'})).state, 'receipt_confirmed');
  assert.deepEqual(r.mails, [a.session]);
  assert.match((await r.side.take(b.session, {state: 'not_submitted', reason: 'captcha_runtime'})).state, /^(needs_user_handoff|manual_submit_required)$/, 'the store\'s own hand-off state');
  assert.equal((await r.side.take(c.session, {state: 'unknown'})).reason, 'submission_outcome_unknown');
  assert.deepEqual(r.notices, [['warn', b.session], ['warn', c.session]]);
  assert.deepEqual(r.away.map(([session]) => session), [b.session, c.session]);
  assert.equal(await r.side.take(a.session, {state: 'not_submitted', reason: 'needs_user'}), null, 'a receipt is final');
  assert.equal(r.mails.length, 1);
});

test('a send put back, and the local tab closed only on the cloud\'s start', async () => {
  const r = rig();
  const a = await r.add('a');
  await r.side.send(a.session);
  assert.equal((await r.side.unsend(a.session)).state, 'queued');
  assert.equal((await r.side.candidates()).length, 1);
  assert.deepEqual(r.closed, []);
  assert.equal(await r.side.closeLocal(a.session), true);
  assert.deepEqual(r.closed, [a.session]);
});

// The controller itself (lib/background-apply-controller.js): a cloud item is left alone by the poll, and the person's Stop on it also reaches the cloud.
test('the poll leaves a cloud item alone, and the person\'s Stop on it stops that job in the cloud too', async () => {
  const {createBackgroundApplyController} = await import('../../../lib/background-apply-controller.js');
  const {keepCloudAuto} = await import('../../../lib/cloud-auto.js');
  const states = {a: {session: 'a', mode: 'auto', chosenAt: 'c1', state: 'cloud', was: 'filling', owner: 'o1', cloudAt: 1}}, handed = [], claimed = [], stopped = [], storage = {};
  const item = id => ({id, url: `https://jobs.example.test/${id}`, background: {}, outcome: ''});
  const controller = createBackgroundApplyController(storage, {
    store: {read: async address => states[address.split('/').pop()], claim: async session => { claimed.push(session); return {ok: false}; },
      handoff: async (_address, session, _owner, reason) => { handed.push(reason); states[session] = {...states[session], state: 'needs_user_handoff', manualOverride: true, reason}; return states[session]; }},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [item('a')], record: id => (id === 'a' ? item('a') : null), report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  keepCloudAuto(storage, {stopFor: session => { stopped.push(session); return true; }});
  const polled = await controller.handle({action: 'poll', owner: 'o1'});
  assert.deepEqual([polled.jobs, polled.checks, claimed], [[], [], []], 'nothing for the Mac to do with it');
  assert.equal((await controller.stopOne('a'))?.reason, 'stopped');
  // after an app restart nothing is cached (no poll ran): the Stop still reaches the cloud (code review of cs 4/4)
  const fresh = createBackgroundApplyController(storage, {store: {read: async () => states.a, handoff: async (_a, session, _o, reason) => ({...states.a, state: 'needs_user_handoff', reason})}, browser: {start: async () => ({owner: 'o1'}), closeSession: async () => true},
    terminals: {list: () => [item('a')], record: id => (id === 'a' ? item('a') : null), report: () => {}}, config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  states.a = {...states.a, state: 'cloud', manualOverride: false};
  stopped.length = 0;
  await fresh.cancel('a');
  assert.deepEqual(stopped, ['a'], 'Cancel after a restart');
  assert.deepEqual([handed, stopped], [['stopped'], ['a']]);
});

// Why (#3815): "the store write failed" must not look like "not a cloud item any more": cloud-auto drops an outcome on null and keeps it on a retry answer.
test('a failed store write answers retry, not null; an item the store no longer holds still answers null', async () => {
  const r = rig();
  const a = await r.add('a'), gone = await r.add('g');
  await r.side.send(a.session);
  const real = r.store.fromCloud;
  let down = true;
  r.store.fromCloud = (...args) => (down ? Promise.reject(new Error('store down')) : real(...args));
  assert.deepEqual(await r.side.take(a.session, {state: 'submitted', attempt: 'att'}), {ok: false, retry: true});
  assert.deepEqual(r.mails, [], 'nothing is recorded or mailed from a failed write');
  down = false;
  assert.equal((await r.side.take(a.session, {state: 'submitted', attempt: 'att'})).state, 'receipt_confirmed', 'the same outcome written on the next try');
  assert.equal(await r.side.take(gone.session, {state: 'submitted', attempt: 'att'}), null, 'never sent: not a cloud item');
  r.records.delete(a.session);
  assert.equal(await r.side.take(a.session, {state: 'submitted', attempt: 'att'}), null, 'no session record: gone');
});

// Why (#3815, Gitar): a job deleted while it is out in the cloud has no Application record: the write can never work, so the outcome is dropped (null), not retried for ever.
test('an outcome for a job whose Application record is gone is dropped, not retried', async () => {
  const r = rig();
  const a = await r.add('a');
  await r.side.send(a.session);
  r.apps.delete(r.records.get(a.session).url);
  assert.equal(await r.side.take(a.session, {state: 'submitted', attempt: 'att'}), null);
  assert.deepEqual(r.mails, []);
});
