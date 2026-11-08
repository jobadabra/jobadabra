// A hidden-browser application whose page the extension cannot reach (a dead end: no form, nothing it may press) is handed to the person, not left "Filling".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';
import {finishedHandoff} from '../../../lib/background-apply-store.js';

const url = id => `https://jobs.example.test/${id}`;
const job = (session, state, more = {}) => ({version: 1, session, mode: 'fill', chosenAt: 'c1', state, owner: 'o1', ...more});
// One controller over fake jobs: `handed` lists each hand-over with its reason.
const rig = states => {
  const handed = [];
  const item = id => ({id, url: url(id), background: {}, outcome: ''});
  const controller = createBackgroundApplyController({}, {
    store: {read: async address => states[address.split('/').pop()],
      claim: async (_address, session) => ({ok: true, state: {...states[session], state: 'preflight', owner: 'o1'}}),
      handoff: async (_address, session, _owner, reason) => { handed.push(`${session}:${reason}`); states[session] = {...states[session], state: 'needs_user_handoff', manualOverride: true, reason}; return states[session]; }},
    browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => Object.keys(states).map(item), record: id => (id in states ? item(id) : null), report: () => {}},
    config: () => ({mode: 'fill', chosenAt: 'c1'}), token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  return {controller, handed, poll: () => controller.handle({action: 'poll', owner: 'o1'})};
};

// Why (8 Nov 2026, owner: "please debug all the applying sessions, find the bugs"): the twin's Lufthansa application (XING, Background) logged
// "can't reach the form: no-form" at 07:33:50, yet its card kept "Filling" with Stop and Watch live: lib/session-flow.js stuck() marked only the
// card, and the hidden run's own state stayed preflight, the state the Sessions list shows first (renderer/pages/sessions.js sessionStatus).
test('the owner\'s scenario: a hidden application at a dead end before its form is handed to the person, and the next poll says so', async () => {
  const control = rig({a: job('a', 'preflight')});
  await control.poll();
  assert.deepEqual((await control.poll()).handoffs || [], [], 'positive control: without the dead end, the run stays the app\'s');
  const {controller, handed, poll} = rig({a: job('a', 'preflight'), b: job('b', 'filling')});
  await poll();
  assert.equal((await controller.deadEnd('a', 'no-form'))?.reason, 'no_form');
  assert.deepEqual(handed, ['a:no_form'], 'only the job at the dead end, the other untouched');
  assert.deepEqual((await poll()).handoffs.map(each => each.session), ['a']);
});

test('a dead end leaves alone a job past its form, one already handed over, an account page and an unknown session', async () => {
  const {controller, handed} = rig({r: job('r', 'ready_for_review'), s: job('s', 'submitting'), h: job('h', 'needs_user_handoff', {manualOverride: true, reason: 'stopped'}), q: job('q', 'queued')});
  for (const id of ['r', 's', 'h', 'nobody']) assert.equal(await controller.deadEnd(id, 'no-form'), null, id);
  assert.equal(await controller.deadEnd('q', 'account'), null, 'an account page is the extension\'s own hand-off (sign_in_required)');
  assert.deepEqual(handed, []);
});

test('nothing was pressed at a dead end, so applying again starts a new run', () => {
  assert.equal(finishedHandoff({state: 'needs_user_handoff', reason: 'no_form'}), true);
  assert.equal(finishedHandoff({state: 'needs_user_handoff', reason: 'opened_in_browser'}), false, 'a form taken to the person\'s browser stays with them');
});
