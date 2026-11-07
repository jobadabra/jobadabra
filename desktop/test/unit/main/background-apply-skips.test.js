// A batch skips what it cannot start and says so: a job the person already has open in Chrome no longer stops the others (owner screenshot, 7 Nov 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';

const touched = [];
const fillConfig = () => ({mode: 'fill', chosenAt: '2026-10-28T10:00:00Z'});
const make = options => createBackgroundApplyController({}, {config: fillConfig, ...options});

// Why (7 Nov 2026, owner screenshot: one open session blocked the whole batch): a job that already has a session of the person's own (in Chrome) is skipped and said; the others still start.
test('in a batch, a job with an open session in Chrome is skipped and said while the others still start; a batch of only such jobs says so', async () => {
  touched.length = 0;
  const open = {id: 'old', url: 'https://jobs.example.test/open'};
  const terminals = {list: () => [], byUrl: url => (url.endsWith('/open') ? open : null), record: () => null, startForm: ({id}) => { touched.push(`startForm ${id}`); return {id}; }};
  const controller = () => make({store: {queue: async url => ({session: `s-${url.slice(-1)}`})}, terminals, token: () => 'test-token', log: () => {}, browser: {ready: () => true, start: async () => { touched.push('browser.start'); return {owner: 'o1'}; }}});
  const result = await controller().enqueue([{url: 'https://jobs.example.test/open'}, {url: 'https://jobs.example.test/b'}], 'fill');
  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions, ['s-b']);
  assert.deepEqual(result.outcomes, [
    {url: open.url, title: '', company: '', status: 'busy', reason: 'This job already has an application session open.'},
    {url: 'https://jobs.example.test/b', title: '', company: '', status: 'started', reason: ''},
  ]);
  assert.match(result.message, /1 job was skipped: it already has an application session open/);
  assert.deepEqual(touched, ['startForm s-b', 'browser.start']);
  touched.length = 0;
  const only = await controller().enqueue([{url: 'https://jobs.example.test/open'}], 'fill');
  assert.equal(only.ok, false);
  assert.equal(only.error, 'This job already has an application session. Continue that session first.');
  assert.deepEqual(only.outcomes, [{url: open.url, title: '', company: '', status: 'busy', reason: 'This job already has an application session open.'}]);
  assert.deepEqual(touched, [], 'nothing started');
});


test('a batch of one job open in Chrome and one the store refuses starts nothing and names both', async () => {
  touched.length = 0;
  const terminals = {list: () => [], byUrl: url => (url.endsWith('/open') ? {id: 'old', url} : null), record: () => null, startForm: () => ({})};
  const refuse = () => { throw Object.assign(new Error('This job is not eligible to start another application.'), {code: 'NOT_ELIGIBLE'}); };
  const result = await make({store: {queue: async () => refuse()}, terminals, token: () => 't', log: () => {}, browser: {ready: () => true, start: async () => { touched.push('browser.start'); return {owner: 'o'}; }}})
    .enqueue([{url: 'https://jobs.example.test/open'}, {url: 'https://jobs.example.test/lead'}], 'fill');
  assert.equal(result.ok, false);
  assert.match(result.error, /Nothing was started\. 1 job was skipped: not eligible.*1 job was skipped: it already has an application session open/);
  assert.deepEqual(result.outcomes, [
    {url: 'https://jobs.example.test/open', title: '', company: '', status: 'busy', reason: 'This job already has an application session open.'},
    {url: 'https://jobs.example.test/lead', title: '', company: '', status: 'ineligible', reason: 'This job is not eligible to start another application.'},
  ]);
  assert.deepEqual(touched, []);
});
