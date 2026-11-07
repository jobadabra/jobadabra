// Missing cover letters stay high priority, independently of employer requiredness: one setup action of its own, never a drawer row (owner, 28 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../../../lib/storage.js';
import {openShown} from '../../../lib/question-lists.js';
import {MUST} from '../../../renderer/question-filter.js';

const storage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'letter-priority-')), {encrypt: v => v, decrypt: v => v});
const ai = {client: {messages: {create: async () => { throw new Error('No generation or classification is needed for a setup action'); }}}};

test('the queues derive exactly one HIGH PRIORITY create action, its own card and in neither drawer', async () => {
  const s = storage();
  for (let i = 0; i < 2; i++) {
    const result = await openShown(s, {rows: [], groups: [], ai});
    const letter = result.letter;
    assert.equal(letter?.setup?.kind, 'cover-letter');
    assert.ok(![...result.details, ...result.learned].some(row => row.setup), 'in neither drawer');
    assert.equal(letter.priority, 'HIGH PRIORITY');
    assert.ok(letter.weight > MUST);
    assert.equal(letter.setup.action, 'Create cover letter');
  }
});


test('delivery failure is the shared actionable state until a letter is observed on the form', async () => {
  const {availableLetter} = await import('../../../lib/letter-availability.js');
  const s = storage();
  const failed = availableLetter(s, '', {failed: true}).status;
  assert.equal(failed.state, 'delivery-failed');
  assert.equal(failed.ready, false);
  assert.match(failed.reason, /form/);
  assert.equal(availableLetter(s, '', {given: true, failed: true}).status.ready, true);
});

test('setup action carries portable typed display recipes without changing canonical delivery status', async () => {
  const {letterQuestion, availableLetter} = await import('../../../lib/letter-availability.js');
  const s = storage(), canonical = availableLetter(s).status;
  const question = letterQuestion(s);
  assert.equal(question.displayCopy.hint.key, 'focusCards.mainLetterMissing');
  assert.equal(question.setup.displayCopy.action.key, 'focusCards.mainLetterCreate');
  assert.equal(question.question, 'Set up your cover letter'); assert.equal(question.priority, 'HIGH PRIORITY');
  assert.deepEqual(availableLetter(s).status, canonical);
  assert.equal(Object.hasOwn(canonical, 'displayCopy'), false, 'delivery status stays canonical and metadata-free');
  assert.deepEqual(JSON.parse(JSON.stringify(question)), question, 'intentional UI metadata survives IPC and cache');
});

test('actual Focus/Jobs IPC authored errors carry recipes while raw errors and control values stay canonical', async () => {
  const {registerFocusHandlers} = await import('../../../lib/focus-handlers.js');
  const handles = new Map(), raw = 'Raw <provider> {error} this Mac ⌘K';
  registerFocusHandlers({DEMO: false, ipcMain: {handle: (name, run) => handles.set(name, run)}, storage: storage(), aiReady: () => false,
    needsNotion: () => null, settingsDeps: () => {throw new Error(raw);}});
  const invoke = (name, ...args) => handles.get(name)(null, ...args);
  const prep = await invoke('interviewPrep', 'raw-page');
  assert.equal(prep.displayCopy.text.key, 'focusCards.mainPrepNeedsAi'); assert.equal(prep.ok, false);
  const review = await invoke('reviewRejection', 'https://fictional.test/job');
  assert.equal(review.displayCopy.text.key, 'focusCards.mainReviewNeedsAi');
  const target = await invoke('setDailyTarget', 5);
  assert.equal(target.error, `Notion: ${raw}. The target wasn't changed.`);
  assert.deepEqual(target.displayCopy.error.values, {error: {value: raw}});
  assert.equal(target.displayCopy.error.key, 'focusCards.mainTargetSaveError');
});

test('real engine-command fallback producers keep diagnostics canonical until the deliberate UI reply', async t => {
  const {registerHooks} = await import('node:module');
  let answer = {code: 1, stdout: 'not json'}, calls = [];
  globalThis.__focusCopyRun = async (...args) => {calls.push(args.slice(1)); return answer;};
  const hooks = registerHooks({resolve(specifier, context, next) {
    if (specifier === './pipeline-run.js' && context.parentURL?.endsWith('pipeline-commands.js?focus-copy-test')) {
      return {url: 'data:text/javascript,' + encodeURIComponent('export const run=(...args)=>globalThis.__focusCopyRun(...args);'), shortCircuit: true};
    }
    return next(specifier, context);
  }});
  t.after(() => {hooks.deregister(); delete globalThis.__focusCopyRun;});
  const commands = await import('../../../lib/pipeline-commands.js?focus-copy-test');
  for (const [name, field, key] of [['focus', 'error', 'mainFocusReadFailed'], ['focusHistory', 'error', 'mainHistoryReadFailed']]) {
    const canonical = await commands[name](storage()), before = JSON.stringify(canonical);
    assert.equal(Object.hasOwn(canonical, 'displayCopy'), false);
    const shown = commands.focusDisplayReply(canonical);
    assert.equal(shown.displayCopy[field].key, `focusCards.${key}`);
    assert.equal(shown[field], canonical[field]); assert.equal(JSON.stringify(canonical), before);
  }
  answer = {code: 1, stdout: ''};
  const fallback = await commands.reviewRejection(storage(), 'https://fictional.test/job');
  assert.equal(commands.focusDisplayReply(fallback).displayCopy.text.key, 'focusCards.mainReviewFailed');
  assert.deepEqual(fallback, {ok: false, text: 'The review failed (see the activity log)'});
  answer = {code: 1, stdout: 'Raw provider {text} this Mac ⌘K'};
  const raw = await commands.reviewRejection(storage(), 'https://fictional.test/job');
  assert.strictEqual(commands.focusDisplayReply(raw), raw, 'unmarked upstream output is never matched or rewritten');
  assert.deepEqual(raw, {ok: false, text: answer.stdout});
  assert.deepEqual(calls.map(call => call[0]), [['src.focus'], ['src.focus', 'history'], ['src.ai.rejection', '--job', 'https://fictional.test/job'], ['src.ai.rejection', '--job', 'https://fictional.test/job']]);
});

test('actual letter setup reasons retain distinct provenance through UI transport without altering approved fallback', async () => {
  const {letterQuestion, availableLetter} = await import('../../../lib/letter-availability.js');
  const letters = await import('../../../lib/cover-letter.js');
  for (const [record, pdf, key] of [
    [{status: 'draft', text: 'Dear Hiring Team, raw letter.'}, false, 'mainLetterDraft'],
    [{status: 'draft', text: 'Dear [Company], raw letter.'}, false, 'mainLetterPlaceholders'],
    [{status: 'approved', text: 'Dear Hiring Team, raw letter.'}, false, 'mainLetterPdfMissing'],
    [{status: 'approved', text: 'Dear Hiring Team, raw letter.'}, 'directory', 'mainLetterPdfReadFailed'],
  ]) {
    const s = storage(); fs.mkdirSync(letters.dir(s));
    fs.writeFileSync(path.join(letters.dir(s), 'letter.json'), JSON.stringify(record));
    if (pdf === 'directory') fs.mkdirSync(letters.pdfPath(s));
    const canonical = availableLetter(s), wire = JSON.stringify(canonical);
    const question = letterQuestion(s);
    assert.equal(question.displayCopy.hint.key, `focusCards.${key}`);
    assert.equal(question.hint, canonical.status.reason);
    assert.equal(question.setup.state, canonical.status.state);
    assert.equal(JSON.stringify(availableLetter(s)), wire);
  }
});

test('serialized Focus/Jobs UI recipes resolve at read time and insert raw provider errors once', async () => {
  const {letterQuestion} = await import('../../../lib/letter-availability.js');
  const {copyField} = await import('../../../i18n/display-copy.js');
  const {registerMessages, setLocale} = await import('../../../i18n/index.js');
  registerMessages('de', 'focusCards', {mainLetterMissing: 'DE missing', mainLetterCreate: 'DE create', mainTargetSaveError: 'DE {error}'});
  const question = JSON.parse(JSON.stringify(letterQuestion(storage())));
  try {
    setLocale('de'); assert.equal(copyField(question, 'hint'), 'DE missing');
    assert.equal(copyField(question.setup, 'action'), 'DE create');
    assert.equal(question.setup.action, 'Create cover letter');
    const raw = 'Raw {error} this Mac <provider> ⌘K', handles = new Map();
    const {registerFocusHandlers} = await import('../../../lib/focus-handlers.js');
    registerFocusHandlers({DEMO: false, ipcMain: {handle: (name, run) => handles.set(name, run)}, storage: storage(), aiReady: () => false,
      needsNotion: () => null, settingsDeps: () => {throw new Error(raw);}});
    const reply = JSON.parse(JSON.stringify(await handles.get('setDailyTarget')(null, 5)));
    assert.equal(copyField(reply, 'error'), `DE ${raw}`);
    assert.equal(reply.error, `Notion: ${raw}. The target wasn't changed.`);
  } finally {setLocale('en');}
});
