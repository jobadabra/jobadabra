// Whether our servers take a schedule yet: only the site's 404 means "not open"; a bad connection or any other answer never claims it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isOpen} from '../../../lib/hosted-search.js';

const storage = {secret: name => (name === 'ANTHROPIC_API_KEY' ? 'JPF1.install-0001.abcd' : ''), settings: () => ({})};
const answer = (status, body = {}) => ({fetcher: async () => ({ok: status < 400, status, text: async () => JSON.stringify(body)})});
const at = minutes => 1e12 + minutes * 60 * 1000;

test('404 from the site is "not open yet"; it is asked again only after 10 minutes', async () => {
  assert.equal(await isOpen(storage, answer(404, {error: 'x'}), at(0)), false);
  assert.equal(await isOpen(storage, answer(200, {schedule: null}), at(5)), false, 'cached for 10 minutes');
  assert.equal(await isOpen(storage, answer(200, {schedule: null}), at(11)), true);
});

test('a refused connection or a server error does not say "not open yet"', async () => {
  assert.equal(await isOpen(storage, {fetcher: async () => { throw new Error('offline'); }}, at(30)), true);
  assert.equal(await isOpen(storage, answer(500), at(50)), true);
});

// Why (code review, 4 Nov 2026): a failed probe was remembered as "open" for 10 minutes, so a closed site stayed pickable after an offline start; and the answer was shared by every key.
test('an offline answer is not remembered: the next ask sees the 404 at once; another key asks again', async () => {
  assert.equal(await isOpen(storage, {fetcher: async () => { throw new Error('offline'); }}, at(100)), true);
  assert.equal(await isOpen(storage, answer(404, {error: 'x'}), at(101)), false, 'asked again a minute later');
  const other = {secret: name => (name === 'ANTHROPIC_API_KEY' ? 'JPF1.install-0002.efgh' : ''), settings: () => ({})};
  assert.equal(await isOpen(other, answer(200, {schedule: null}), at(102)), true, 'not the first key\'s cached answer');
});
