// Background jobs filling at once ([ap] 6/7 review): Stop on one hands it over at once, one bad job never stops the poll, and a store refusal is never kept as a state.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';

const url = id => `https://jobs.example.test/${id}`;
const job = (session, state, owner = 'o1', more = {}) => ({session, mode: 'auto', chosenAt: 'c1', state, owner, ...more});
// One controller over fake jobs: `reads` counts store reads per job, `handed` lists each hand-over with its reason, `logs` keeps the controller's log lines.
const rig = (states, {read, claimFails = () => false} = {}) => {
  const reads = [], handed = [], claimed = [], logs = [];
  const item = id => ({id, url: url(id), background: {}, outcome: ''});
  const controller = createBackgroundApplyController({}, {
    store: {read: read || (async address => { const id = address.split('/').pop(); reads.push(id); return states[id]; }),
      claim: async (_address, session) => { if (claimFails(session)) throw new Error('store busy'); claimed.push(session); return {ok: true, state: {...states[session], state: 'preflight', owner: 'o1'}}; },
      handoff: async (_address, session, _owner, reason) => { handed.push(`${session}:${reason}`); states[session] = {...states[session], state: 'needs_user_handoff', manualOverride: true, reason}; return states[session]; }},
    browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => Object.keys(states).map(item), record: id => (id in states ? item(id) : null), report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), token: () => 't', notify: () => {}, stop: () => false, log: (...args) => logs.push(args)});
  const poll = () => controller.handle({action: 'poll', owner: 'o1'});
  return {controller, poll, reads, handed, claimed, logs};
};

// Why (review of [ap] 6/7): the Stop mark lived only on the session; the job's next fill report cleared it (session-flow.js → clearStuck) before the poll read it,
// so a Full automation job went on to its press. stop: () => false and no item.stuck below play that cleared mark.
test('Stop on one job filling beside others hands only that one to the person at once, even after its fill report cleared the mark', async () => {
  const control = rig({a: job('a', 'filling'), b: job('b', 'filling')});
  await control.poll();
  assert.deepEqual((await control.poll()).handoffs, [], 'positive control: with the mark cleared, the poll alone never hands the job over');
  const {controller, poll, handed} = rig({a: job('a', 'filling'), b: job('b', 'filling')});
  await poll();
  assert.equal((await controller.stopOne('a'))?.reason, 'stopped');
  assert.deepEqual(handed, ['a:stopped'], 'handed over before any later poll, the other job untouched');
  const after = await poll();
  assert.deepEqual(after.handoffs.map(each => each.session), ['a']);
  assert.deepEqual(after.jobs, []);
});

// Gitar on #3273: the Full automation queue step has no Stop (owner, 5 Nov 2026: Stop stays in the Background step), so the press side is proven here.
test('Full automation: a job stopped while others fill is never pressed, even when its wait is due', async () => {
  const due = () => ({a: job('a', 'waiting_to_submit', 'o1', {readyAt: 1}), b: job('b', 'filling')});
  const control = rig(due());
  assert.deepEqual((await control.poll()).checks, [{session: 'a'}], 'positive control: unstopped, its due wait asks the extension for the press');
  const {controller, poll} = rig(due());
  await controller.stopOne('a');
  const after = await poll();
  assert.deepEqual(after.checks, [], 'no press asked for the stopped job');
  assert.deepEqual(after.handoffs.map(each => each.session), ['a']);
});

test('Stop leaves alone a job being sent, one already handed over and an unknown session', async () => {
  const {controller, handed} = rig({s: job('s', 'submitting'), r: job('r', 'receipt_confirmed'), h: job('h', 'needs_user_handoff', 'o1', {manualOverride: true, reason: 'stopped'})});
  for (const id of ['s', 'r', 'h', 'nobody']) assert.equal(await controller.stopOne(id), null, id);
  assert.deepEqual(handed, []);
});

test('a job whose claim throws is skipped for this poll alone: the queued job beside it still launches, and the next poll tries it again', async () => {
  let fails = 1;
  const {poll, claimed, logs} = rig({bad: job('bad', 'queued', ''), good: job('good', 'queued', '')}, {claimFails: session => session === 'bad' && fails-- > 0});
  assert.deepEqual((await poll()).jobs.map(each => each.session), ['good']);
  assert.ok(logs.some(([, words, detail]) => words === 'one background application skipped this poll' && detail.session === 'bad'));
  assert.ok((await poll()).jobs.some(each => each.session === 'bad'), 'the next poll claims it');
  assert.equal(claimed.filter(id => id === 'bad').length, 1);
});

test('a store refusal or another run\'s state is never kept: the next poll reads the store again and launches the job', async () => {
  for (const first of [{ok: false, error: 'engine busy'}, job('other-run', 'filling')]) {
    const states = {q: job('q', 'queued', '')};
    let answer = first;
    const reads = [];
    const {poll} = rig(states, {read: async address => { reads.push(address); const now = answer; answer = states.q; return now; }});
    assert.deepEqual((await poll()).jobs, [], `nothing launches on ${JSON.stringify(first)}`);
    assert.deepEqual((await poll()).jobs.map(each => each.session), ['q']);
    assert.equal(reads.length, 2);
  }
});
