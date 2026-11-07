// Background batch preflight refusals retain per-job outcomes before any queue or browser work.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';

test('a Background batch reports each selected job when mode, browser or capacity preflight refuses it', async () => {
  const jobs = [{url: 'https://jobs.example.test/a', title: 'Fictional role A', company: 'Example Air'}];
  const held = Array.from({length: 10}, (_, index) => ({id: `held-${index}`, background: {}}));
  const cases = [
    {config: () => ({mode: 'auto', chosenAt: 'c1'}), ready: true, error: 'Confirm the saved Apply mode first.'},
    {config: () => ({mode: 'fill', chosenAt: 'c1'}), ready: false, code: 'BACKGROUND_BROWSER_MISSING', error: "Download Jobadabra's browser first: about 200 MB, only once."},
    {config: () => ({mode: 'fill', chosenAt: 'c1'}), ready: true, held, error: 'At most 10 background forms can stay open. Finish or cancel one first.'},
  ];
  for (const item of cases) {
    const result = await createBackgroundApplyController({}, {
      config: item.config, store: {queue: async () => assert.fail('preflight refusal must happen before a queue write')},
      browser: {ready: () => item.ready, start: async () => assert.fail('preflight refusal must happen before browser launch')},
      terminals: {list: () => item.held || [], byUrl: () => null},
    }).enqueue(jobs, 'fill');
    assert.equal(result.ok, false);
    assert.equal(result.error, item.error);
    if (item.code) assert.equal(result.code, item.code);
    assert.deepEqual(result.outcomes, jobs.map(({url, title, company}) => ({url, title, company, status: 'failed', reason: item.error})));
  }
});
