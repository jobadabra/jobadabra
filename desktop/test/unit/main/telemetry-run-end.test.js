// A run that ends badly is reported as failed only when it failed: one stopped from outside is not (desktop/lib/telemetry-handlers.js runFailure).
// Why: 20 Oct 2026, private issues #28 and #34 were runs the person stopped, filed as failures with their last ordinary line as the error.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JOB_STOPPED} from '../../../lib/pipeline.js';
import {runFailure} from '../../../lib/telemetry-handlers.js';

test('a run stopped from outside (no exit code, not the watchdog) is not a failed run', () => {
  assert.equal(runFailure({code: null, timedOut: false, tail: ['Enriched 100 of 100 job(s); 0 failed']}), null);
});

test('a run the app ended on purpose is not a failed run, whatever exit code the OS gave (143 from the engine, 1 from taskkill)', () => {
  for (const code of [143, 1, 130]) assert.equal(runFailure({code, timedOut: false, stopped: true, tail: ['Stopped before it finished: Jobadabra was closed, or Stop was pressed']}), null);
  assert.ok(runFailure({code: 124, timedOut: 'no output for 16 min', stopped: true, tail: []}), 'the watchdog is never a stop');
});

test('a job the engine stopped on purpose is not a failed run: it said why at the press', () => {
  assert.equal(runFailure({code: JOB_STOPPED, timedOut: false, tail: ['⚠️ This job\'s posting could not be read']}), null);
  assert.ok(runFailure({code: JOB_STOPPED, timedOut: 'no output for 16 min', tail: []}), 'the watchdog is never a stop');
});

test('"0 failed" is a count, not the error line', () => {
  assert.equal(runFailure({code: 1, timedOut: false, tail: ['Boom: ValueError: x', 'Enriched 0 of 0 job(s) with a model; 0 failed; tokens in 0, out 0', 'Interview sweep: 0 application(s) moved on']}).error, 'Boom: ValueError: x');
});

test('a failed run\'s Sentry event carries its exit code and seconds', async () => {
  const sentry = await import('../../../lib/sentry.js');
  const event = sentry.buildEvent('run_failed', {job: 'src scheduled', code: 1, seconds: 42, error: 'exit 1, no error line', tail: ['x']}, {});
  assert.deepEqual(event.extra, {tail: ['x'], code: 1, seconds: 42});
  assert.deepEqual(sentry.buildEvent('run_failed', {job: 'j', error: 'e', tail: ['x']}, {}).extra, {tail: ['x']});
});

test('the watchdog and a non-zero exit are failed runs, with their error line', () => {
  assert.deepEqual(runFailure({code: 124, timedOut: 'no output for 16 min', tail: ['AI budget: $0.00']}),
    {error: 'stopped by the app: no output for 16 min', timedOut: 'no output for 16 min', cutOff: false});
  assert.equal(runFailure({code: 1, timedOut: false, tail: ['Traceback (most recent call last):', 'TypeError: x', 'done']}).error, 'TypeError: x');
  assert.equal(runFailure({code: null, timedOut: 'no output for 31 min', tail: []}).error, 'stopped by the app: no output for 31 min');
});

// Sentry 2C (24 Oct 2026): a store call keeps its stdout private, so a failure with a quiet stderr had an empty tail and the event read "run_failed · src.stores call:".
test('a failed run with no tail still says its error kind, never an empty error', () => {
  assert.equal(runFailure({code: 1, timedOut: false, tail: [], errorKind: 'OperationalError'}).error, 'OperationalError');
  assert.equal(runFailure({code: 1, timedOut: false, tail: []}).error, 'exit 1, no error line');
});

// Sentry 4H, 4W, 4R, 4T, 4J, 4Q (31 Oct-5 Nov 2026, one Windows tester's scheduled runs): the engine exited non-zero after a normal-looking run, and the report's title was its last ORDINARY line
// ("Enriched 5 of 5 job(s)…", "Digest ready…", "Codex answered in 3 s"), six issues for one unexplained exit. The label now says what is known: the exit code and that no line is an error.
// It is the report's label, not the cause: the cause waits for an event carrying `code` (lib/sentry.js runExtra).
test('a non-zero exit with no error line is labelled by its exit code, never by an ordinary last line', () => {
  const tails = [['Claude Code haiku: answered in 3 s', '⏱ Time is up for this refresh: 95 job(s) left for the next one (it stops at 3 min)', 'Enriched 5 of 5 job(s) with claude-haiku-5-5; 0 failed; tokens in 24, out 10286'],
    ['Digest ready: 10 jobs, 40 new. Telegram isn\'t connected, so nothing was sent.'], ['Interview sweep: 0 application(s) moved on after a recorded interview.']];
  for (const tail of tails) {
    const failure = runFailure({code: 1, timedOut: false, tail});
    assert.equal(failure.error, 'exit 1, no error line');
    assert.equal(runFailure({code: 143, timedOut: false, tail}).error, 'exit 143, no error line');
  }
  assert.equal(runFailure({code: 1, timedOut: false, tail: ['Boom: ValueError: x', 'Enriched 5 of 5 job(s); 0 failed']}).error, 'Boom: ValueError: x', 'a real error line still wins');
});

// Sentry JOB-PILOTTO-APP-4Z, 4Y (4-5 Nov 2026, Windows): a job that died because this computer had no connection ("getaddrinfo failed", "[WinError 10051]") was reported as a failed run.
// No connection is the person's network, not our bug: not reported, for any job. Anything else with the same exception class is still a failure.
test('a run that died with no connection is not a failed run', () => {
  for (const line of ['urllib.error.URLError: <urlopen error [Errno 11001] getaddrinfo failed>', 'urllib.error.URLError: <urlopen error [WinError 10051] A socket operation was attempted to an unreachable network>',
    'urllib.error.URLError: <urlopen error [Errno -2] Name or service not known>', 'urllib.error.URLError: <urlopen error [Errno 101] Network is unreachable>', 'urllib.error.URLError: <urlopen error [Errno 8] nodename nor servname provided, or not known>']) {
    assert.equal(runFailure({code: 1, timedOut: false, tail: ['  File "request.py", line 1360, in do_open', '    raise URLError(err)', line]}), null, line);
  }
  assert.ok(runFailure({code: 1, timedOut: false, tail: ['urllib.error.URLError: <urlopen error [Errno 111] Connection refused>']}), 'a refused server is not "no connection"');
  assert.ok(runFailure({code: 1, timedOut: false, tail: ['Error: Notion rejected title "No route to host engineer"']}), 'words inside a title are no network error');
  assert.ok(runFailure({code: 1, timedOut: false, tail: ['Error: Notion rejected title "getaddrinfo failed"']}), 'getaddrinfo failed inside a title is no network error either');
  assert.ok(runFailure({code: 1, timedOut: 'no output for 16 min', tail: ['getaddrinfo failed']}), 'the watchdog is never excused by a tail');
});

test('every captured kind gets a non-empty message, even from empty fields', async () => {
  const sentry = await import('../../../lib/sentry.js');
  for (const kind of sentry.CAPTURED) {
    for (const fields of [{}, {error: ''}, {message: ''}, {warning: ''}, {action: ''}, {error: '', message: '', job: 'src.stores call'}]) {
      const event = sentry.buildEvent(kind, fields, {});
      const text = event.message ?? event.exception.values[0].value;
      assert.ok(String(text).replace(/^[^:]*:\s*/, '').trim(), `${kind} ${JSON.stringify(fields)} -> "${text}"`);
    }
  }
});

test('a private run reports only the type of its failure, never the message', async () => {
  const {errorKindOf} = await import('../../../lib/pipeline-run.js');
  assert.equal(errorKindOf('{"error": "OperationalError: no such column ada@example.com"}\n'), 'OperationalError');
  assert.equal(errorKindOf('{"error": "not callable: events.put"}'), '');
  assert.equal(errorKindOf('garbage'), '');
});
