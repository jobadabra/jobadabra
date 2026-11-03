// "Dismiss this question" (owner, 2 Nov 2026: "we don't have an option to dismiss a question"): ONE state (settings.dismissedQuestions) read by the one list builder, so a
// dismissed question is gone from both drawers, their counts (the lists are the counts), Focus and "what Claude needs", comes back with Bring back, and the store is untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as lists from '../lib/question-lists.js';
import * as dismissed from '../lib/question-dismissed.js';

const storage = () => createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-dismiss-')), 'x'), {encrypt: v => v, decrypt: v => v});
const fact = {key: 'details:open:{"home":"availability","label":"Notice period"}', question: 'How long is your notice period?', format: {kind: 'text'}, details: {kind: 'open', fact: 'Notice period'}};
const form = {key: 'visa', question: 'Do you need visa sponsorship?', format: {kind: 'text'}};
const verdicts = {verdicts: [{label: 'Do you need visa sponsorship?', verdict: 'reusable', covered_by: ''}]};
const ai = {client: {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify(verdicts)}]})}}};
const read = s => lists.openShown(s, {rows: [{question: form.question, key: form.key}], groups: [], details: [fact], ai});

test('a dismissed question leaves its drawer and is listed as dismissed; Bring back asks it again', async () => {
  const s = storage();
  let now = await read(s);
  assert.deepEqual([now.details.length, now.learned.length], [1, 1]);
  assert.equal(dismissed.dismiss(s, fact.key, fact.question).ok, true);
  assert.equal(dismissed.dismiss(s, form.key, form.question).ok, true);
  now = await read(s);
  assert.deepEqual([now.details.length, now.learned.length], [0, 0], 'both drawers, so their counts');
  assert.deepEqual([now.dismissed.details.map(q => q.key), now.dismissed.learned.map(q => q.key)], [[fact.key], [form.key]]);
  assert.ok(now.dismissed.details[0].dismissed, 'marked for the drawer');
  assert.equal(dismissed.isDismissed(s, fact.key), true);
  dismissed.bringBack(s, fact.key);
  now = await read(s);
  assert.deepEqual([now.details.length, now.learned.length], [1, 0]);
});

test('"what Claude needs" does not ask a dismissed question either', () => {
  const s = storage();
  const groups = [{category: 'Visa', items: [{question: form.question, answer: '', open: true}]}];
  s.saveSettings({questionVerdicts: {'do you need visa sponsorship': {reuse: 'reusable', covered_by: '', proposal: ''}}});
  assert.equal(lists.filterGroups(s, groups).flatMap(group => group.items).length, 1);
  dismissed.dismiss(s, form.key, form.question);
  assert.equal(lists.filterGroups(s, groups).flatMap(group => group.items).length, 0);
});

test('dismissing changes nothing but the one setting', () => {
  const s = storage();
  s.saveSettings({answerClarity: {a: 'vague'}});
  dismissed.dismiss(s, 'k', 'Why?');
  assert.deepEqual(Object.keys(s.settings()).filter(key => ['dismissedQuestions', 'answerClarity'].includes(key)).sort(), ['answerClarity', 'dismissedQuestions']);
  assert.equal(dismissed.dismiss(s, '', 'x').ok, false, 'no key, no dismissal');
});
