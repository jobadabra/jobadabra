// A merged Jobs row stands for every copy of its posting: a status change reaches them all, the row's own first (owner, 5 Nov 2026: "marks every copy").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {alsoOnTags, countPostings, holdsAny, linksOf, onEveryCopy, setStatusOnCopies} from '../../../renderer/pages/jobs-copies.js';

const job = {url: 'https://www.jobup.ch/b', copies: ['https://www.jobup.ch/b', 'https://www.jobs.ch/a', 'https://example.org/c'], also_on: ['jobs.ch', 'example.org']};

test('Mark applied on a merged row marks every copy, its own link first, and answers with its own result', async () => {
  const calls = [];
  const result = await setStatusOnCopies(job, 'applied', async (url, status) => { calls.push([url, status]); return {ok: true, stage: `stage of ${url}`}; });
  assert.deepEqual(calls, job.copies.map(url => [url, 'applied']));
  assert.equal(result.stage, 'stage of https://www.jobup.ch/b');
});

test('a refusal on the first link stops the rest and is the answer the row shows', async () => {
  const calls = [];
  const result = await setStatusOnCopies(job, 'applied', async (url) => { calls.push(url); return {ok: false, error: 'Notion is down'}; });
  assert.deepEqual(calls, ['https://www.jobup.ch/b']);
  assert.deepEqual(result, {ok: false, error: 'Notion is down'});
});

test('a refusal after some links changed says so, never "not changed"', async () => {
  const result = await onEveryCopy(job, async (url) => (url.includes('jobs.ch') ? {ok: false, error: 'Notion is down'} : {ok: true}));
  assert.equal(result.ok, false);
  assert.match(result.error, /Changed on 1 of 3 links, then: Notion is down/);
});

test('Delete, Not submitted and outcomes go through the same every-copy call', async () => {
  const seen = [];
  await onEveryCopy(job, async (url) => { seen.push(url); return {ok: true}; });
  assert.deepEqual(seen, job.copies);
  assert.deepEqual(linksOf([job, {url: 'https://a/1'}]), [...job.copies, 'https://a/1']);
});

test('a failing call is a refusal, never a thrown error', async () => {
  const result = await setStatusOnCopies(job, 'dismissed', async () => { throw new Error('IPC closed'); });
  assert.deepEqual(result, {ok: false, error: 'IPC closed'});
});

test('a row that is not merged changes its one link; its tags are empty', async () => {
  const calls = [];
  await setStatusOnCopies({url: 'https://a/1'}, 'saved', async (url) => { calls.push(url); return {ok: true}; });
  assert.deepEqual(calls, ['https://a/1']);
  assert.deepEqual(alsoOnTags({url: 'https://a/1'}), []);
  assert.deepEqual(alsoOnTags(job).map(tag => tag.text), ['Also on jobs.ch', 'Also on example.org']);
});

const key = url => url.toLowerCase();
test('a merged row is held by any of its links, so a counter and the rows it opens agree', () => {
  const keys = new Set(['https://www.jobs.ch/a']);   // a run found the copy that is not the row's own link
  assert.equal(holdsAny(job, keys, key), true);
  assert.equal(holdsAny({url: 'https://x/1'}, keys, key), false);
});

test('a run card counts postings, not links: both copies of one posting are one', () => {
  const rows = [job, {url: 'https://x/1'}];
  assert.deepEqual(countPostings(['https://www.jobs.ch/a', 'https://www.jobup.ch/b', 'https://x/1', 'https://new/9'], rows, key), {postings: 3, inJobs: 2});
  assert.deepEqual(countPostings(['https://a/1', 'https://a/2'], [], key), {postings: 2, inJobs: 2});   // no list yet: nothing to subtract
});
