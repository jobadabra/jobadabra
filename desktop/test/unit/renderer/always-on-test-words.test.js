// Always on's Test button, every sentence a person can meet (renderer/always-on-test-words.js): why it is off, what it does, one chip per state, what a failed or stopped test says.
import test from 'node:test';
import assert from 'node:assert/strict';
import {advance, searchLine, searchWatch, shouldPropose, proposeLead, NOTIFY_CHECK, NOTIFY_SETUP, NOTIFY_LEAD_PROPOSE, NEVER_LISTED, TOO_LONG, TOO_LONG_OURS, lead, list, pillFor, buttonFor, chipFor, summary, startFailed, OURS_FOR, FOR} from '../../../renderer/always-on-test-words.js';

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
  assert.match(OURS_FOR, /first search/);
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

test('the first search is one line apart from the verdict: running with the wait, then the count, or why it failed', () => {
  assert.equal(searchLine(null), '');
  assert.equal(searchLine({state: 'running', found: 0, note: ''}), 'First search: running, results by e-mail in about 10 minutes');
  assert.equal(searchLine({state: 'ok', found: 4, note: ''}), 'Last search: 4 new jobs');
  assert.equal(searchLine({state: 'ok', found: 1, note: ''}), 'Last search: 1 new job');
  assert.equal(searchLine({state: 'ok', found: 0, note: ''}), 'Last search: 0 new jobs');
  assert.equal(searchLine({state: 'failed', found: 0, note: 'It did not report back.'}), 'Last search: failed: It did not report back.');
  assert.equal(searchLine({state: 'failed', found: 0, note: ''}), 'Last search: failed');
  assert.doesNotMatch(searchLine({state: 'running'}), /GitHub|Actions/);
});

test('our servers: a search still running never makes the test "too long"; a verdict stuck for a minute does', () => {
  const stuck = {found: true, verdict: 'running', search: {state: 'running', found: 0, note: ''}};
  assert.deepEqual(advance({phase: 'running', read: stuck, elapsedMs: 20_000, seen: true, way: 'ours'}), {phase: 'running', message: '', again: true});
  assert.equal(advance({phase: 'running', read: stuck, elapsedMs: 61_000, seen: true, way: 'ours'}).message, TOO_LONG_OURS);
  assert.equal(advance({phase: 'running', read: {found: true, verdict: 'passed', search: {state: 'running'}}, elapsedMs: 15 * 60_000, seen: true, way: 'ours'}).phase, 'passed');
  const older = {found: true, verdict: 'running'};   // a site without `search`: its verdict waits for the search, as before
  assert.equal(advance({phase: 'running', read: older, elapsedMs: 120_000, seen: true, way: 'ours'}).again, true);
});

test('a failed step that depends on the person\'s notification settings says to check them, with one link word', () => {
  assert.equal(NOTIFY_CHECK, 'Check notifications');
  assert.equal(NOTIFY_SETUP, 'Set up notifications');
  assert.match(NOTIFY_LEAD_PROPOSE, /did not reach you/);
  assert.match(summary('failed', [{title: 'A test e-mail was sent to you', state: 'failed', settings: true}], 'ours'), /^A test e-mail was sent to you: no\. Set up notifications, then test again\.$/);
});

test('the first search is watched only after a passed verdict, for 20 minutes, then it says "no answer yet"; a failed test promises no e-mail', () => {
  const running = {state: 'running', found: 0, note: ''};
  assert.equal(searchWatch(running, 'passed', 15_000), 'again');
  assert.equal(searchWatch(running, 'passed', 19 * 60_000), 'again');
  assert.equal(searchWatch(running, 'passed', 21 * 60_000), 'late');
  assert.equal(searchWatch(running, 'failed', 15_000), 'done');
  assert.equal(searchWatch({state: 'ok', found: 2, note: ''}, 'passed', 15_000), 'done');
  assert.equal(searchWatch(null, 'passed', 15_000), 'done');
  assert.match(searchLine({state: 'late'}), /^Last search: no answer yet/);
});

test('the owner scenario: the verdict ends with the test e-mail failed while the search runs -> the pop-up is proposed once, with the site\'s own reason; never mid-test', () => {
  const mail = {id: 'mail', state: 'failed', settings: true, line: 'E-mail alerts are off. Turn them on in Settings → Notifications.'};
  const steps = [{id: 'ai', state: 'ok'}, mail];
  assert.equal(shouldPropose({steps, again: false, proposed: false}), mail);
  assert.equal(shouldPropose({steps, again: true, proposed: false}), null, 'a test still running proposes nothing');
  assert.equal(shouldPropose({steps, again: false, proposed: true}), null, 'once per press');
  assert.equal(shouldPropose({steps: [{id: 'ai', state: 'ok'}, {...mail, state: 'ok'}], again: false, proposed: false}), null, 'a delivered test e-mail proposes nothing');
  assert.equal(shouldPropose({steps: [{id: 'ai', state: 'failed'}], again: false, proposed: false}), null, 'another failed step is not a notification problem');
  assert.match(proposeLead(mail.line), /^E-mail alerts are off\..*Change a way here, then test again\.$/);
  assert.match(proposeLead(''), /did not reach you/);
});
