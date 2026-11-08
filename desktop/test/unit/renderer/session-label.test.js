// A session's one label (renderer/session-state.js sessionLabel), the order every screen reads: an ending always outranks what the session's tab says.
// Why (8 Nov 2026, owner: "Yes, build it (Recommended)", sketch https://claude.ai/artifact/GvEcS5F6Z5Q5Zh7NPM8nZj): the twin's Sessions list said "Form closed" for HYPE and ACM,
// stopped by the person, and for Resource Group, whose form could not be reached: the closed tab was checked before the session's own ending, in 3 copied chains.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dockBucket, dockOrder, sessionEnded, sessionLabel} from '../../../renderer/session-state.js';

const CLOSED = ['Form closed', 'neutral'];
const form = more => ({id: 'f', kind: 'form', status: 'done', live: false, endedAt: '2026-11-08T07:00:00Z', note: 'Form open in Chrome', ...more});
const gone = () => true;

test('an ending outranks a closed tab: Stopped, can\'t reach the form, needs sign-in, confirm e-mail', () => {
  assert.deepEqual(sessionLabel(form(), {tab: CLOSED}), CLOSED, 'positive control: an open form whose tab went is "Form closed"');
  for (const [more, label] of [[{stuck: 'stopped'}, 'Stopped'], [{stuck: 'no-form'}, 'Can\'t reach form'], [{stuck: 'account', accountStep: 'sign_in'}, 'Needs sign-in'],
    [{stuck: 'incomplete'}, 'Needs you'], [{accountState: 'confirm'}, 'Confirm your email']]) {
    assert.equal(sessionEnded(form(more)), true, label);
    assert.equal(sessionLabel(form(more), {tab: CLOSED})[0], label, `${label} with its tab closed`);
    assert.equal(sessionLabel(form(more), {tab: ['Tab not found', 'warn']})[0], label, `${label} with its tab lost`);
  }
});

test('Cancelling outranks everything, then a hidden run\'s own state, then a submitted session', () => {
  assert.deepEqual(sessionLabel(form({stuck: 'stopped', cancelling: true}), {tab: CLOSED}), ['Cancelling…', 'neutral']);
  assert.deepEqual(sessionLabel({id: 'h', background: {state: 'needs_user_handoff', reason: 'no_form'}, stuck: 'no-form'}, {tab: CLOSED}), ['Needs you', 'warn']);
  assert.deepEqual(sessionLabel({id: 'h', background: {state: 'filling'}}), ['Filling', 'info']);
  assert.deepEqual(sessionLabel(form({outcome: 'submitted'}), {tab: CLOSED}), ['Submitted', 'good']);
});

test('the running states still read the tab: a form whose tab went is closed, one still checking says so', () => {
  assert.deepEqual(sessionLabel(form(), {tab: ['Checking…', 'neutral']}), ['Checking…', 'neutral']);
  assert.deepEqual(sessionLabel(form()), ['Form open', 'info']);
  assert.deepEqual(sessionLabel(form(), {formReady: true}), ['Ready to submit', 'good']);
});

test('the dock follows the label: a stopped form whose tab went needs you, an open one that went waits', () => {
  assert.equal(dockBucket(form(), gone), 'waiting', 'positive control');
  assert.equal(dockBucket(form({stuck: 'stopped'}), gone), 'needs');
  assert.equal(dockBucket(form({stuck: 'no-form'}), gone), 'needs');
  assert.equal(dockOrder(form({stuck: 'stopped'}), gone) < dockOrder(form(), gone), true, 'an ending sorts before the closed forms');
});
