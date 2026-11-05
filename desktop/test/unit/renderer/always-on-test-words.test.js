// Always on's Test button, every sentence a person can meet (renderer/always-on-test-words.js): why it is off, what it does, one chip per state, what a failed or stopped test says.
import test from 'node:test';
import assert from 'node:assert/strict';
import {advance, NEVER_LISTED, TOO_LONG, TOO_LONG_OURS, lead, list, pillFor, buttonFor, chipFor, summary, startFailed, OURS_FOR, FOR} from '../../../renderer/always-on-test-words.js';

test('the line names what is still missing, or says what the test does and does not do', () => {
  assert.equal(list(['Notion']), 'Notion');
  assert.equal(list(['Notion', 'GitHub']), 'Notion and GitHub');
  assert.equal(list(['Notion', 'an API key', 'GitHub']), 'Notion, an API key and GitHub');
  assert.match(lead(['an API key', 'GitHub']), /Set up an API key and GitHub above first/);
  assert.equal(lead([]), FOR);
  assert.match(FOR, /searches and sends nothing/);
});

test('our servers say what one press does, whatever is missing above (their test needs none of the three)', () => {
  assert.equal(lead([], 'ours'), OURS_FOR);
  assert.equal(lead(['Notion'], 'ours'), OURS_FOR);
  assert.match(OURS_FOR, /one real search/);
  assert.match(OURS_FOR, /e-mails you/);
});

test('our servers name the failed step and where to write, and never send a person to GitHub', () => {
  const steps = [{title: 'The search started', state: 'ok'}, {title: 'The search finished', state: 'failed'}];
  assert.match(summary('passed', steps, 'ours'), /Everything works on our servers/);
  assert.match(summary('failed', steps, 'ours'), /^The search finished: no\. Press Test again in a few minutes/);
  assert.match(summary('failed', [], 'ours'), /ended before every step ran/);
  for (const text of [summary('passed', steps, 'ours'), summary('failed', steps, 'ours'), summary('failed', [], 'ours'), TOO_LONG_OURS, OURS_FOR]) assert.doesNotMatch(text, /GitHub|Actions/, text);
  assert.match(summary('passed', steps), /All three work/);   // the own-accounts sentence is unchanged
});

test('every phase has a pill or none, and the button follows it', () => {
  assert.equal(pillFor('idle'), null);
  assert.deepEqual(['starting', 'running', 'passed', 'failed', 'cancelled'].map(phase => pillFor(phase)[0]), ['Starting', 'Testing', 'Passed', 'Failed', 'Stopped']);
  assert.deepEqual(buttonFor('idle'), {text: 'Test Always on', busy: false});
  assert.deepEqual(buttonFor('failed'), {text: 'Test again', busy: false});
  assert.equal(buttonFor('running').busy, true);
  assert.equal(buttonFor('starting').busy, true);
});

test('every check state has a word, never colour alone', () => {
  for (const state of ['waiting', 'running', 'ok', 'failed', 'skipped', 'cancelled']) assert.ok(chipFor(state).text.length > 2, state);
  assert.equal(chipFor('ok').text, 'Works');
  assert.equal(chipFor('nonsense').text, 'Waiting');
});

test('the summary names the failed check, and a run that ended early says to open it', () => {
  const steps = [{state: 'ok', title: 'A'}, {state: 'failed', title: 'Your AI key answers'}];
  assert.match(summary('failed', steps), /Your AI key answers: no\. Fix that one/);
  assert.match(summary('failed', [{state: 'ok', title: 'A'}]), /Open the run/);
  assert.match(summary('passed', steps), /All three work/);
  assert.match(summary('cancelled', []), /second press/);
  assert.equal(summary('running', steps), '');
});

test('a refused start is one short line', () => {
  assert.equal(startFailed('Resource not accessible\n by integration'), 'The test did not start: Resource not accessible by integration');
  assert.match(startFailed(''), /did not answer/);
  assert.ok(startFailed('x'.repeat(500)).length < 260);
});

test('every wait ends in a verdict: a run never listed fails after 90 s, a running one after 6 min, so the button always comes back', () => {
  const none = {found: false}, running = {found: true, verdict: 'running'};
  assert.deepEqual(advance({phase: 'starting', read: none, elapsedMs: 5000}), {phase: 'starting', message: '', again: true});
  assert.match(advance({phase: 'starting', read: none, elapsedMs: 40000}).message, /not listed the test run yet/);
  assert.deepEqual(advance({phase: 'starting', read: none, elapsedMs: 91000}), {phase: 'failed', message: NEVER_LISTED, again: false});
  assert.deepEqual(advance({phase: 'running', read: running, elapsedMs: 60000}), {phase: 'running', message: '', again: true});
  assert.deepEqual(advance({phase: 'running', read: running, elapsedMs: 361000}), {phase: 'failed', message: TOO_LONG, again: false});
});

test('a finished run is final and clears an earlier "not listed yet" line', () => {
  for (const verdict of ['passed', 'failed', 'cancelled']) assert.deepEqual(advance({phase: 'running', read: {found: true, verdict}, elapsedMs: 500000}).again, false, verdict);
  assert.equal(advance({phase: 'starting', read: {found: true, verdict: 'running'}, elapsedMs: 40000}).message, '');
});

test('a failed read, or a read after the run was seen, never says "never listed": it keeps polling to the 6-minute limit', () => {
  const blip = {found: false, error: 'GitHub 502'};
  assert.deepEqual(advance({phase: 'running', read: blip, elapsedMs: 120000, seen: true}), {phase: 'running', message: '', again: true});
  assert.deepEqual(advance({phase: 'starting', read: blip, elapsedMs: 120000}), {phase: 'starting', message: '', again: true});
  assert.deepEqual(advance({phase: 'running', read: {found: false}, elapsedMs: 120000, seen: true}).again, true);
  assert.deepEqual(advance({phase: 'running', read: blip, elapsedMs: 361000, seen: true}), {phase: 'failed', message: TOO_LONG, again: false});
});

test('our servers know the run from the press: a read that finds nothing keeps polling, and the limit says "press again"', () => {
  assert.deepEqual(advance({phase: 'running', read: {found: false}, elapsedMs: 100 * 1000, seen: true, way: 'ours'}), {phase: 'running', message: '', again: true});
  const late = advance({phase: 'running', read: {found: true, verdict: 'running'}, elapsedMs: 7 * 60 * 1000, seen: true, way: 'ours'});
  assert.deepEqual(late, {phase: 'failed', message: TOO_LONG_OURS, again: false});
  assert.deepEqual(advance({phase: 'running', read: {found: true, verdict: 'passed'}, elapsedMs: 1000, seen: true, way: 'ours'}), {phase: 'passed', message: '', again: false});
});

test('a start that fails with no reason names the right party for each way', () => {
  assert.match(startFailed('', 'ours'), /Jobadabra did not answer/);
  assert.doesNotMatch(startFailed('', 'ours'), /GitHub/);
  assert.match(startFailed(''), /GitHub did not answer/);
  assert.match(startFailed('Wait 10 minutes between tests.', 'ours'), /Wait 10 minutes/);
});
