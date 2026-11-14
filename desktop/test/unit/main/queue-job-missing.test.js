// A job's missing questions go into the answers queue when its drawer asks (owner, 14 Nov 2026, #4325: "make it easy for him to fix all the issues" · "Either using the answers queue"): readiness
// reads a form without filling it, so "Seen twice" (a fill's 1st sighting stays with its job) never queued them. Plays the real store and the real fill writer, with a stored check naming the gap.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../../../lib/storage.js';
import * as store from '../../../lib/store/index.js';
import * as questions from '../../../lib/questions.js';
import * as verdicts from '../../../lib/question-verdicts.js';
import {queueMissing} from '../../../lib/queue-job-missing.js';
import {keyOf, BLOCKED, factScore} from '../../../renderer/question-filter.js';
import {missingOf} from '../../../lib/triage-match.js';

const fresh = () => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-queue-job-')), {encrypt: v => v, decrypt: v => v}); s.saveSettings({store: 'sqlite', telemetry: false}); return s; };
const JOB = {url: 'https://jobs.example/acme-sre', company: 'Acme'};
const ASKED = 'How did you perform in mathematics at high school?', FACT_Q = 'What is your citizenship?';
// What the check's match left: the first sighting of a reusable question (its verdict is kept with its job, "once"), and a question that means the Your details fact Nationality.
const judged = {[keyOf(ASKED)]: {reuse: 'reusable', covered_by: '', question: ASKED, asked: 1, v: 7}, [keyOf(FACT_Q)]: {reuse: 'details', fact: 'Nationality', question: FACT_Q, asked: 1, v: 7}};
const read = missingOf([ASKED, FACT_Q], judged, [{label: 'Nationality', value: ''}]);
const parts = (check = async () => ({questions: [ASKED, FACT_Q], match: read})) => ({check, questions, verdicts});

test('a missing question of the stored check is written to the answers page and marked as blocking this job; pressing again adds nothing twice', async () => {
  const s = fresh();
  s.saveSettings({questionVerdicts: judged});
  const first = await queueMissing(s, JOB, parts());
  assert.equal(first.ok, true);
  assert.deepEqual(first.items, [{kind: 'answer', label: ASKED}, {kind: 'detail', label: 'Nationality'}]);
  assert.equal(first.added, 1, 'the reusable question is on the answers page now, not waiting for a second employer');
  assert.match(await store.openStore(s).page('answers').text(), new RegExp(`${ASKED.replace('?', '\\?')}: ❓ \\(asked by Acme\\)`));
  const known = verdicts.cached(s);
  assert.equal(known[keyOf(ASKED)].blocked, true);
  assert.ok(known[keyOf(FACT_Q)].blocked && factScore('Nationality', known) >= BLOCKED, 'the Your details fact is asked at once (lib/missing-facts.js pick: a blocking fact skips the daily cap)');
  const again = await queueMissing(s, JOB, parts());
  assert.equal(again.added, 0, 'the line is already there');
  assert.equal(verdicts.cached(s)[keyOf(ASKED)].asked, 2, 'a second press on the same job does not count as another form asking it');
});

test('a job with no stored check queues nothing and says so (the drawer then offers Check again)', async () => {
  const s = fresh();
  s.saveSettings({questionVerdicts: judged});
  assert.deepEqual(await queueMissing(s, JOB, parts(async () => null)), {ok: false, reason: 'no check', items: [], added: 0});
  assert.equal(await store.openStore(s).page('answers').text().then(text => text.includes(ASKED)), false);
});

test('an item with no full asked question (a check stored before `asked`, or cut) queues nothing and marks nothing, never a guess from its label (Gitar on #4394)', async () => {
  const s = fresh();
  s.saveSettings({questionVerdicts: judged});
  const cut = {questions: [ASKED], match: {missing: [{kind: 'answer', label: ASKED.slice(0, 20)}], unjudged: 0, unnamed: 0}};
  const got = await queueMissing(s, JOB, parts(async () => cut));
  assert.equal(got.added, 0);
  assert.equal(await store.openStore(s).page('answers').text().then(text => text.includes(ASKED.slice(0, 20))), false);
  assert.equal(verdicts.cached(s)[keyOf(ASKED)].blocked, undefined, 'no job-blocking mark on a question the check cannot name in full');
});

test('an asked question whose verdict the store no longer holds is reported as skipped, never as queued (Gitar on #4396)', async () => {
  const s = fresh();
  s.saveSettings({questionVerdicts: {[keyOf(ASKED)]: judged[keyOf(ASKED)]}});   // the Nationality verdict was evicted
  const got = await queueMissing(s, JOB, parts());
  assert.deepEqual(got.skipped, [FACT_Q]);
  assert.equal(verdicts.cached(s)[keyOf(FACT_Q)], undefined);
});
