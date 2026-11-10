// Guard: release — a red main told twice for two commits with the same failed step (8 Nov 2026, "apply · red on main" at 18:25 and 23:01) is noise that hides the next real red.
// Why (10 Nov 2026, owner's shot): alertHtml sent no `state`, so the switchboard's "changes only" mode could not hold a repeat; stateOf is the one place that names it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stateOf} from '../../lib/alert-events.mjs';

const apply = {suite: 'apply', step: 'the triage bar moves'}, wizard = {suite: 'wizard', step: 'a required field is missing'};
const day = '2026-11-08T18:25:00Z';

test('the same red step on two commits the same UTC day has the same state (the switchboard holds the second)', () => {
  const first = stateOf('failure', {causes: [apply], now: new Date(day)}), second = stateOf('failure', {causes: [apply], now: new Date('2026-11-08T23:01:00Z')});
  assert.equal(first.level, 'problem');
  assert.match(first.state, /^red:[0-9a-z]+:2026-11-08$/);
  assert.equal(first.state, second.state);
});

test('another step, another set of steps or the next day tells again; the order of the steps does not matter', () => {
  const base = stateOf('failure', {causes: [apply], now: new Date(day)}).state;
  assert.notEqual(base, stateOf('failure', {causes: [wizard], now: new Date(day)}).state);
  assert.notEqual(base, stateOf('failure', {causes: [apply, wizard], now: new Date(day)}).state);
  assert.notEqual(base, stateOf('failure', {causes: [apply], now: new Date('2026-11-09T00:05:00Z')}).state);
  assert.equal(stateOf('failure', {causes: [apply, wizard], now: new Date(day)}).state, stateOf('failure', {causes: [wizard, apply], now: new Date(day)}).state);
});

test('a recovery is its own message every time: no state; a failure with no named step falls back to the failed jobs', () => {
  assert.deepEqual(stateOf('success'), {level: 'ok'});
  assert.match(stateOf('failure', {jobs: [{name: 'apply-1of3'}], now: new Date(day)}).state, /^red:/);
  assert.equal(stateOf('failure', {now: new Date(day)}).state, undefined, 'nothing named: no state, never a shared one');
});
