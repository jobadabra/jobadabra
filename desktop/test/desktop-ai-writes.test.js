// What the desktop AI may write (lib/desktop-ai-writes.js) on a real local store: the tester's scenario (a label saved as an answer), a confirmed value, a place the AI chose, the cap, and Undo that never
// overwrites the person's later edit. The queue the tool validates against is the one the window sends (renderer `questions` entry); here it is built from the store's own open rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as sections from '../lib/profile-sections.js';
import * as questions from '../lib/questions.js';
import * as dismissed from '../lib/question-dismissed.js';
import * as changes from '../lib/desktop-ai-changes.js';
import {answerQuestion, dismissQuestion, undoChange, checkAnswer} from '../lib/desktop-ai-writes.js';
import {desktopAiSources} from '../lib/desktop-ai-handlers.js';
import {callTool} from '../lib/desktop-ai-tools.js';

const ANSWERS = '## Common questions\n- Notice period: ❓ (asked by Acme)\n- How did you hear about us?: ❓\n- Salary expectation: CHF 120,000\n';
const fresh = async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ai-writes-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  const opened = store.openStore(storage);
  await opened.page('profile').write('## Targets\n- **Roles:** Site Reliability Engineer\n');
  await opened.page('answers').write(ANSWERS);
  return storage;
};
const keyOf = async (storage, question) => (await questions.list(storage)).find(q => q.question === question).key;
const deps = (storage, items, extra = {}) => ({storage, queue: async () => (items === null ? null : {questions: items}), calls: [], ...extra});
const row = (key, question, over = {}) => ({list: 'learned', key, question, kind: '', value: '', hint: '', review: '', state: '', ...over});
const answersText = storage => store.openStore(storage).page('answers').text();

test('the tester\'s scenario: a label saved as the answer, an empty answer and a bare space are refused with a reason, nothing is written or recorded', async () => {
  const storage = await fresh();
  const key = await keyOf(storage, 'Notice period'), d = deps(storage, [row(key, 'Notice period')]);
  const before = await answersText(storage);
  for (const value of ['Notice period', 'notice period:', '', '   ']) {
    const done = await answerQuestion(d, {key, value});
    assert.ok(done.error, `"${value}" must be refused`);
  }
  assert.match((await answerQuestion(d, {key, value: 'Notice period'})).error, /label/);
  assert.equal(await answersText(storage), before, 'the page is untouched');
  assert.deepEqual(changes.list(storage), []);
});

test('an answer is saved as New through the drawer\'s save, recorded with what was there, and Undo puts the open question back exactly', async () => {
  const storage = await fresh();
  const key = await keyOf(storage, 'Notice period'), d = deps(storage, [row(key, 'Notice period')]);
  const was = await questions.rawOf(storage, key);
  assert.match(was, /❓/);
  const done = await answerQuestion(d, {key, value: '3 months'});
  assert.equal(done.data.saved, true);
  assert.match(await answersText(storage), /Notice period: 3 months \(new\)/);
  const [entry] = changes.list(storage);
  assert.deepEqual([entry.client, entry.tool, entry.target, entry.before === was, entry.after.includes('3 months (new)')], ['Claude Desktop', 'answer_question', key, true, true]);
  assert.equal(done.data.changeId, entry.id);
  assert.deepEqual(await undoChange(d, entry.id), {ok: true});
  assert.match(await answersText(storage), /Notice period: ❓ \(asked by Acme\)/);
  assert.ok(changes.find(storage, entry.id).undoneAt);
  assert.match((await undoChange(d, entry.id)).error, /already undone/);
});

test('Undo does nothing when the person changed the answer since, and says so', async () => {
  const storage = await fresh();
  const key = await keyOf(storage, 'Notice period'), d = deps(storage, [row(key, 'Notice period')]);
  await answerQuestion(d, {key, value: '3 months'});
  const page = store.openStore(storage).page('answers');
  const block = (await page.blocks()).find(each => each.id === key);
  await page.setText(block, 'Notice period: 6 weeks');   // the person edits it
  const [entry] = changes.list(storage);
  const done = await undoChange(d, entry.id);
  assert.equal(done.ok, false);
  assert.match(done.error, /changed this since/);
  assert.match(await answersText(storage), /Notice period: 6 weeks/, 'their edit stands');
  assert.equal(changes.find(storage, entry.id).undoneAt, undefined);
});

test('a value the person confirmed, a two-answers line, a decision item and a Your details item are refused; so is a question that is not in the list', async () => {
  const storage = await fresh();
  const key = await keyOf(storage, 'Notice period');
  const cases = [[row(key, 'Notice period', {value: '2 months'}), /confirmed/], [row(key, 'Notice period', {value: '2 months', state: 'conflict'}), /confirmed|two answers/],
    [row(key, 'Notice period', {review: 'taught'}), /confirmed|two answers/], [row(key, 'Notice period', {list: 'details'}), /Your details/]];
  for (const [item, pattern] of cases) assert.match((await answerQuestion(deps(storage, [item]), {key, value: '3 months'})).error, pattern);
  assert.match((await answerQuestion(deps(storage, [row(key, 'Notice period')]), {key: 'row-that-is-not-there', value: 'x'})).error, /no longer open/);
  assert.match((await answerQuestion(deps(storage, null), {key, value: 'x'})).error, /not read the questions/);
  assert.match(await answersText(storage), /Notice period: ❓/, 'nothing was written');
  assert.deepEqual(changes.list(storage), []);
});

test('a value its field cannot read is refused with an example that reads, and a pick-one field takes only its options', async () => {
  const salary = {question: 'Salary', kind: 'salary', options: undefined};
  assert.match(checkAnswer(salary, 'a lot'), /does not read as salary.*120000 CHF\/year gross/);
  assert.equal(checkAnswer(salary, '120000 CHF/year gross'), '');
  const { canonical } = await import('../renderer/question-values.js');
  for (const [kind, example] of [['salary', '120000 CHF/year gross'], ['duration', '3 months'], ['range', '40–60 %'], ['language', 'B2'], ['link', 'https://example.com/me']]) {
    assert.equal(canonical(kind, example), example, `the example for ${kind} must be a form the drawer reads`);
  }
  const pick = {question: 'Title', kind: 'single', options: ['Mr', 'Mrs']};
  assert.match(checkAnswer(pick, 'Dr'), /Pick one of: Mr \| Mrs/);
  assert.equal(checkAnswer(pick, 'mrs'), '');
  assert.match(checkAnswer({question: '  '}, 'x'), /no question/);
  assert.match(checkAnswer({question: 'Notice'}, 'x'.repeat(2000)), /longer than/);
});

test('with a place the AI chose the answer is written to Your details and asks no AI; an unknown place is refused with the valid ones', async () => {
  const storage = await fresh();
  const key = await keyOf(storage, 'Notice period'), d = deps(storage, [row(key, 'Notice period')]);
  const bad = await answerQuestion(d, {key, value: '3 months', home: 'nowhere'});
  assert.match(bad.error, /Unknown place "nowhere".*availability/);
  const done = await answerQuestion(d, {key, value: '3 months', home: 'availability'});
  assert.match(done.data.note, /Your details/);
  assert.deepEqual((await sections.read(storage)).availability, [{label: 'Notice period', value: '3 months'}]);
  const [entry] = changes.list(storage);
  assert.match((await undoChange(d, entry.id)).error, /change it there/, 'a moved answer is changed where it went, never silently');
});

test('dismiss hides the question like the drawer and Undo brings it back; the 61st write in ten minutes is refused, refused calls counted too', async () => {
  const storage = await fresh();
  const key = await keyOf(storage, 'How did you hear about us?'), d = deps(storage, [row(key, 'How did you hear about us?')]);
  const done = await dismissQuestion(d, {key});
  assert.equal(done.data.dismissed, true);
  assert.equal(dismissed.isDismissed(storage, key), true);
  assert.deepEqual(await undoChange(d, done.data.changeId), {ok: true});
  assert.equal(dismissed.isDismissed(storage, key), false);
  const capped = deps(storage, [row(key, 'x')], {calls: Array.from({length: 60}, () => 1_000_000), now: () => 1_000_005});
  assert.match((await answerQuestion(capped, {key, value: 'ok'})).error, /Slow down/);
  assert.match((await dismissQuestion(capped, {key})).error, /Slow down/);
});

test('through the tool list, with the window\'s own list: the AI reads the key, answers it, sees it in list_my_changes, and a later call for a closed window says to open the app', async () => {
  const storage = await fresh();
  const key = await keyOf(storage, 'Notice period');
  const window = answer => ({isDestroyed: () => false, webContents: {executeJavaScript: async () => answer}});
  const loaded = window({screen: 'questions', source: 'registry', data: {questions: [row(key, 'Notice period')], dismissed: 0}});
  const sources = desktopAiSources({app: {getVersion: () => '1', getPath: () => os.tmpdir()}, storage, getWindow: () => loaded});
  const done = await callTool('answer_question', {key, value: '3 months'}, sources);
  assert.equal(done.isError, false, done.text);
  assert.match(done.text, /Saved as New/);
  const listed = await callTool('list_my_changes', {}, sources);
  assert.match(listed.text, /Notice period/);
  assert.match(listed.text, /"canUndo": true/);
  const closed = desktopAiSources({app: {getVersion: () => '1', getPath: () => os.tmpdir()}, storage, getWindow: () => window({screen: 'questions', source: 'none', data: null})});
  const refused = await callTool('answer_question', {key, value: '4 months'}, closed);
  assert.equal(refused.isError, true);
  assert.match(refused.text, /not read the questions/);
});
