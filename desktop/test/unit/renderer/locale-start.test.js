// A missing or failed language IPC must not prevent the desktop renderer from starting.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startWithLocale} from '../../../renderer/locale-start.js';

test('a rejected locale read applies English and still starts the application', async () => {
  const calls = [];
  const result = await startWithLocale({read: async () => { throw new Error('No handler registered for locale'); },
    apply: state => calls.push(state), start: () => { calls.push('start'); return 'started'; }, onUnavailable: () => calls.push('outdated')});
  assert.deepEqual(calls, [{choice: 'en', locale: 'en'}, 'start', 'outdated']); assert.equal(result, 'started');
});

test('a missing locale method falls back and a saved locale is applied before application imports', async () => {
  const calls = [];
  await startWithLocale({read: () => undefined, apply: state => calls.push(state.locale), start: () => calls.push('start')});
  await startWithLocale({read: async () => ({choice: 'ru', locale: 'ru'}), apply: state => calls.push(state.locale), start: () => calls.push('start')});
  assert.deepEqual(calls, ['en', 'start', 'ru', 'start']);
});

test('startup waits for locale-dependent controls to finish importing', async () => {
  const calls = [];
  await startWithLocale({read: async () => ({choice: 'fr', locale: 'fr'}), apply: async state => {
    calls.push(state.locale); await Promise.resolve(); calls.push('controls');
  }, start: () => calls.push('pages')});
  assert.deepEqual(calls, ['fr', 'controls', 'pages']);
});
