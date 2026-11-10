// The result line of "Apply readiness on the top matches" (lib/top-matches-line.js). Owner, 9 Nov 2026, asked via AskUserQuestion: "Rename + result line (Recommended)",
// e.g. "3 jobs checked: 2 simple, 1 needs you". One loop over all 7 languages and over the plural cases, so a language cannot lose a word or a plural form.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classify, resultLine} from '../../../lib/top-matches-line.js';
import {SUPPORTED_LOCALES} from '../../../i18n/index.js';
import {completionText} from '../../../i18n/completion-notices.js';

const SIMPLE = {eligible: true, simple: true, captcha: false, login: false, accountCreation: false, questions: [], match: {missing: [], unnamed: 0, unjudged: 0}};
const NEEDS = {eligible: true, simple: false, why: 'questions', captcha: false, login: false, accountCreation: false};

test('each checked job is counted once as simple, needs you or could not be read; a job the read found not eligible is only checked', () => {
  const results = [{check: SIMPLE}, {check: SIMPLE}, {check: NEEDS}, {check: null}, {check: {unreadable: true}}, {check: {...SIMPLE, eligible: false}}, {check: {...SIMPLE, captcha: true}}];
  assert.deepEqual(classify(results), {checked: 7, simple: 2, needs: 2, unread: 2}, 'a simple form behind a captcha is Needs you, as its chip says');
});

test('a job a gate refused (no Notion, no allowance, no AI) or a Stop cut short was not checked, so it is not counted at all (code review of 3/4)', () => {
  const results = [{kit: {ok: true}, check: SIMPLE}, {kit: {ok: false, refused: true}, check: null}, {kit: {ok: true}, check: null, cancelled: true}, {kit: {ok: true}, check: null}];
  assert.deepEqual(classify(results), {checked: 2, simple: 1, needs: 0, unread: 1});
});

test('the owner\'s example in English, a state with no job left out, and the singular', () => {
  assert.equal(resultLine({checked: 3, simple: 2, needs: 1, unread: 0}, 'en'), '3 jobs checked: 2 simple, 1 needs you');
  assert.equal(resultLine({checked: 3, simple: 0, needs: 3, unread: 0}, 'en'), '3 jobs checked: 3 need you');
  assert.equal(resultLine({checked: 1, simple: 0, needs: 0, unread: 1}, 'en'), '1 job checked: 1 couldn’t be read');
  assert.equal(resultLine({checked: 2, simple: 0, needs: 0, unread: 0}, 'en'), '2 jobs checked');
});

test('all 7 languages say every state, with the number and no raw placeholder, for each plural form of the numbers 1 to 25', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const count of [1, 2, 3, 5, 11, 21, 22, 25]) {
      const line = resultLine({checked: count, simple: count, needs: count, unread: count}, locale);
      assert.ok(!/[{}]/.test(line), `${locale} ${count}: ${line}`);
      assert.equal((line.match(new RegExp(`\\b${count}\\b`, 'g')) || []).length, 4, `${locale} ${count}: every part carries the number: ${line}`);
    }
    for (const key of ['readinessLine', 'readinessChecked', 'readinessSimple', 'readinessNeeds', 'readinessUnread']) assert.notEqual(completionText(locale, key, {count: 2}), key, `${locale} has ${key}`);
  }
});
