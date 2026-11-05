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
