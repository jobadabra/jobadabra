// The Mac's Full automation item and the cloud (cloud browser runner 4/4, spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "cs 4/4 Design", model A): `sendToCloud` hands an item
// before its press to the cloud (state `cloud`), and `fromCloud` writes the site's outcome back. The store is the item's one owner: a `cloud` item is never claimed, readied or reserved by the Mac again
// (no local double press), survives the next start's quit sweep, and an outcome never overwrites a receipt. Guard: safety (never Submit twice).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyStore} from '../../../lib/background-apply-store.js';

const config = {mode: 'auto', chosenAt: '2026-10-27T10:00:00Z', autoConfirmedAt: '2026-10-27T10:00:01Z', auto: {waitMin: 0}};
const ready = {answer: 'ready', step: 'final', submitControl: 'Send my application', requiredComplete: true, factsOnly: true, safe: true, botCheck: false, signature: 'page-1'};
function rig() {
  let time = Date.parse('2026-10-27T12:00:00Z'), id = 0;
  const apps = new Map(), sections = new Map(), events = [];
  const call = async (_storage, entity, method, args) => {
    if (entity === 'applications') {
      if (method === 'get') return apps.get(args.url) || null;
      if (method === 'section') return sections.get(`${args.app_id}:${args.name}`) || '';
      if (method === 'set_section') { sections.set(`${args.app_id}:${args.name}`, args.markdown); return null; }
    }
    if (entity === 'events' && method === 'list') return events.filter(e => !args.kind || e.kind === args.kind);
    if (entity === 'events' && method === 'add') { const row = {...args, id: `e${++id}`}; events.push(row); return row; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  const store = createBackgroundApplyStore({}, {call, now: () => time, realNow: () => time, uuid: () => `attempt-${++id}`});
  const job = {id: 'job-1', url: 'https://jobs.example.test/1', fit: 90, company: 'Fictional Cloud', stage: 'Kit ready'};
  apps.set(job.url, job);
  sections.set(`${job.id}:📝 Application kit`, '```json\n{"eligible":true,"answers":[]}\n```');
  return {store, job, state: () => JSON.parse(sections.get(`${job.id}:Background Apply`)), events, advance: ms => { time += ms; }};
}
const queued = async r => (await r.store.queue(r.job.url, 'session-1', 'auto', config));
const claimed = async r => { const row = await queued(r); await r.store.claim(r.job.url, row.session, 'owned'); return row; };

test('an item before its press goes to the cloud and keeps its own stamp; the Mac never acts on it again', async () => {
  for (const step of ['queued', 'claimed', 'ready']) {
    const r = rig();
    const row = step === 'queued' ? await queued(r) : await claimed(r);
    if (step === 'ready') await r.store.ready(r.job.url, row.session, 'owned', ready);
    const sent = await r.store.sendToCloud(r.job.url, row.session);
    assert.equal(sent.state, 'cloud', step);
    assert.equal(r.state().autoConfirmedAt, config.autoConfirmedAt, 'the item keeps its own confirmation');
    assert.ok(r.state().cloudAt > 0);
    assert.deepEqual(await r.store.claim(r.job.url, row.session, 'owned-2'), {ok: false}, `${step}: no local claim`);
    await r.store.ready(r.job.url, row.session, 'owned', ready);
    assert.equal(r.state().state, 'cloud', `${step}: a local ready moves nothing`);
    const verdict = await r.store.reserve(r.job.url, row.session, 'owned', ready, {auto: {waitMin: 0}});
    assert.equal(verdict.submit, false, `${step}: no local reservation`);
    assert.equal(r.events.length, 0, `${step}: nothing reserved on the Mac`);
    assert.equal(await r.store.interrupted(r.job.url, row.session, {quit: true}), null, `${step}: the next start's quit sweep leaves it to the cloud`);
    assert.equal(r.state().state, 'cloud');
  }
});

test('an item that cannot press any more is never sent: handed over, pressed, receipt, another mode or another session', async () => {
  const r = rig();
  const row = await claimed(r);
  assert.equal(await r.store.sendToCloud(r.job.url, 'other-session'), null);
  await r.store.handoff(r.job.url, row.session, 'owned', 'stopped');
  assert.equal(await r.store.sendToCloud(r.job.url, row.session), null, 'a handed-over item stays with the person');
  const p = rig(), pressed = await claimed(p);
  await p.store.ready(p.job.url, pressed.session, 'owned', ready);
  assert.equal((await p.store.reserve(p.job.url, pressed.session, 'owned', ready, {auto: {waitMin: 0}})).submit, true);
  assert.equal(await p.store.sendToCloud(p.job.url, pressed.session), null, 'a press the Mac started is never sent again');
  const f = rig(), fill = await f.store.queue(f.job.url, 'session-f', 'fill', {...config, mode: 'fill'});
  assert.equal(await f.store.sendToCloud(f.job.url, fill.session), null, 'only Full automation goes to the cloud');
});

test('the site\'s outcome is written back: submitted is a receipt, not sent keeps its reason, unknown is the person\'s to check', async () => {
  const cases = [[{state: 'submitted', attempt: 'cloud-attempt'}, 'receipt_confirmed'], [{state: 'unknown'}, 'needs_user_handoff'], [{state: 'not_submitted', reason: 'not_eligible'}, 'needs_user_handoff']];
  for (const [outcome, expected] of cases) {
    const r = rig(), row = await queued(r);
    await r.store.sendToCloud(r.job.url, row.session);
    const done = await r.store.fromCloud(r.job.url, row.session, outcome);
    assert.equal(done.state, expected, JSON.stringify(outcome));
    if (outcome.state === 'submitted') assert.deepEqual([r.state().cloudAttempt, r.state().via], ['cloud-attempt', 'cloud']);
    if (outcome.state === 'unknown') assert.equal(r.state().reason, 'submission_outcome_unknown');
    if (outcome.reason) assert.equal(r.state().reason, 'not_eligible');
  }
});

test('an outcome never overwrites a receipt, a press the person owns or another session; a press after a Stop is still recorded', async () => {
  const r = rig(), row = await queued(r);
  await r.store.sendToCloud(r.job.url, row.session);
  assert.equal(await r.store.fromCloud(r.job.url, 'other-session', {state: 'submitted'}), null);
  await r.store.fromCloud(r.job.url, row.session, {state: 'submitted', attempt: 'a'});
  assert.equal(await r.store.fromCloud(r.job.url, row.session, {state: 'not_submitted', reason: 'needs_user'}), null, 'a receipt is final');
  assert.equal(r.state().state, 'receipt_confirmed');
  const s = rig(), stopped = await queued(s);
  await s.store.sendToCloud(s.job.url, stopped.session);
  await s.store.handoff(s.job.url, stopped.session, '', 'stopped');   // the person's Stop: the app also tells the site, which may be too late
  assert.equal((await s.store.fromCloud(s.job.url, stopped.session, {state: 'not_submitted', reason: 'stopped'})), null, 'a refusal after a Stop changes nothing');
  assert.equal((await s.store.fromCloud(s.job.url, stopped.session, {state: 'submitted', attempt: 'b'})).state, 'receipt_confirmed', 'a press that crossed the Stop is told, never hidden');
});

test('a send that failed puts the item back where it was, and only a cloud item', async () => {
  const r = rig(), row = await claimed(r);
  await r.store.ready(r.job.url, row.session, 'owned', ready);
  const before = r.state().state;
  assert.equal(await r.store.unsend(r.job.url, row.session), null, 'an item not sent is untouched');
  await r.store.sendToCloud(r.job.url, row.session);
  const back = await r.store.unsend(r.job.url, row.session);
  assert.equal(back.state, before);
  assert.equal(r.state().cloudAt, undefined);
  assert.equal(r.state().owner, 'owned', 'its own browser keeps it');
  await r.store.sendToCloud(r.job.url, row.session);
  await r.store.fromCloud(r.job.url, row.session, {state: 'submitted', attempt: 'a'});
  assert.equal(await r.store.unsend(r.job.url, row.session), null, 'a receipt never goes back');
});
