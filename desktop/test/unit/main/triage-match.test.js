// The check's one match of required questions against saved details (lib/triage-match.js, L2b of #3519): what blocks a simple form from applying automatically, in ONE AI call per check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {matchReads, missingOf} from '../../../lib/triage-match.js';
import {createStorage} from '../../../lib/storage.js';
import {keyOf} from '../../../renderer/question-filter.js';

const FACTS = [{label: 'Phone', value: '+41 79 000 00 00'}, {label: 'Notice period', value: ''}, {label: 'Street', value: 'Rue du Lac 1'}];
const judged = rows => Object.fromEntries(Object.entries(rows).map(([label, verdict]) => [keyOf(label), verdict]));

test('what blocks a form: a Your details fact with no value, a reusable question nothing covers, a private one; what does not: consent, one job\'s, covered, a saved fact', () => {
  const verdicts = judged({
    'Mobile number': {reuse: 'details', fact: 'Phone', sensitive: false},
    'When can you start?': {reuse: 'details', fact: 'Notice period', sensitive: false},
    'Do you speak French?': {reuse: 'reusable', covered_by: '', sensitive: false},
    'Years with Kubernetes?': {reuse: 'reusable', covered_by: 'Years of experience', sensitive: false},
    'Why this company?': {reuse: 'one_job', sensitive: false},
    'I accept the privacy terms': {reuse: 'consent', sensitive: false},
    'Your gender': {reuse: 'reusable', covered_by: '', sensitive: true},
  });
  const labels = ['Mobile number', 'When can you start?', 'Do you speak French?', 'Years with Kubernetes?', 'Why this company?', 'I accept the privacy terms', 'Your gender'];
  assert.deepEqual(missingOf(labels, verdicts, FACTS), {
    missing: [{kind: 'detail', label: 'Notice period'}, {kind: 'answer', label: 'Do you speak French?'}, {kind: 'answer', label: 'Your gender'}], unjudged: 0, unnamed: 0});
});

test('a question with no verdict is counted as unjudged, never guessed as saved or missing', () => {
  assert.deepEqual(missingOf(['Anything new'], {}, FACTS), {missing: [], unjudged: 1, unnamed: 0});
  assert.deepEqual(missingOf([], {}, FACTS), {missing: [], unjudged: 0, unnamed: 0});
});

test('the same missing detail asked twice by one form is listed once', () => {
  const verdicts = judged({'Start date': {reuse: 'details', fact: 'Notice period', sensitive: false}, 'Earliest start': {reuse: 'details', fact: 'Notice period', sensitive: false}});
  assert.deepEqual(missingOf(['Start date', 'Earliest start'], verdicts, FACTS).missing, [{kind: 'detail', label: 'Notice period'}]);
});

function storage() {
  return createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
}

test('a whole check is ONE AI call for every new question across its forms, and each form gets its own missing list', async () => {
  const calls = [];
  const verdict = (label, fields) => ({label, verdict: 'reusable', covered_by: '', value: '', topic: label.toLowerCase(), fact: '', asks: '', country: '', sensitive: false, ...fields});
  const client = {messages: {create: async request => {
    calls.push(request);
    return {content: [{type: 'text', text: JSON.stringify({verdicts: [verdict('Mobile number', {fact: 'Phone'}), verdict('Start date', {fact: 'Notice period'}), verdict('Do you speak French?', {})]})}], usage: {}};
  }}};
  const reads = [{url: 'https://a.example/1', questions: ['Mobile number', 'Start date']}, {url: 'https://b.example/2', questions: ['Mobile number', 'Do you speak French?']}, {url: 'https://c.example/3', questions: []}];
  const kept = storage();
  const found = await matchReads(kept, reads, {ai: {client}, facts: FACTS, answered: []});
  assert.equal(calls.length, 1, 'one call for the whole check');
  assert.deepEqual(found['https://a.example/1'].missing, [{kind: 'detail', label: 'Notice period'}]);
  assert.deepEqual(found['https://b.example/2'].missing, [{kind: 'answer', label: 'Do you speak French?'}]);
  assert.equal('https://c.example/3' in found, false, 'a form with no questions is not matched');
  const again = await matchReads(kept, reads.slice(0, 1), {ai: {client}, facts: FACTS, answered: []});
  assert.equal(calls.length, 1, 'the verdicts are kept (question-verdicts.js): the next check asks the AI nothing for a question judged before');
  assert.equal(again['https://a.example/1'].unjudged, 0);
});

test('with the AI off every question is unjudged and nothing is asked', async () => {
  const found = await matchReads(storage(), [{url: 'https://a.example/1', questions: ['Mobile number']}], {ai: {}, facts: FACTS, answered: []});
  assert.deepEqual(found['https://a.example/1'], {missing: [], unjudged: 1, unnamed: 0});
});

test('a failed judgment is logged with its cause and leaves every question unjudged, never a verdict', async () => {
  const logged = [];
  const client = {messages: {create: async () => { throw new Error('429 rate limited'); }}};
  const found = await matchReads(storage(), [{url: 'https://a.example/1', questions: ['Mobile number']}], {ai: {client}, facts: FACTS, answered: [], log: (...line) => logged.push(line)});
  assert.deepEqual(found['https://a.example/1'], {missing: [], unjudged: 1, unnamed: 0});
  assert.match(JSON.stringify(logged), /429 rate limited/);
});

test('a required box the page gave no question text (only a field id) is counted apart: never judged, never "busy AI"', () => {
  assert.deepEqual(missingOf(['text-3219', 'field_123'], {}, FACTS), {missing: [], unjudged: 0, unnamed: 2});
  assert.deepEqual(missingOf(['text-3219', 'Anything new'], {}, FACTS), {missing: [], unjudged: 1, unnamed: 1});
});
