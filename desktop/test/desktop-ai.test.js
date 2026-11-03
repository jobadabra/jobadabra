// "Let the Claude or ChatGPT desktop app answer your questions": when the offer shows (the Focus and Jobs row, the banner on What we learned), and what its two buttons do.
// Why (2 Nov 2026, owner): a friend's Claude Desktop answered the questions queue by itself; we offer it. Nothing shows without the app, without an open learned question, before Focus is read, or after Not now.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {QUESTION_DOES, questionEntries} from '../renderer/question-entries.js';
import {KEY, instruction, words} from '../renderer/desktop-ai-words.js';

install();
const document = globalThis.document;
const calls = [];
globalThis.window.pilot = new Proxy({platform: 'win32', desktopAiHelp: async () => { calls.push('help'); return {ok: true, family: 'claude', opened: true}; }},
  {get: (target, key) => target[key] ?? (async () => ({}))});
globalThis.document.addEventListener ??= () => {};
const {questionsNow} = await import('../renderer/pages/jobs-questions.js');
const {addDesktopAiCommands, appendDesktopAiOffer, desktopAiBanner, offered, setDesktopAiSeams} = await import('../renderer/pages/desktop-ai.js');

const learned = [{question: 'Why this company?', key: 'a'}];
const set = (state, seams = {}) => {
  Object.assign(questionsNow(), {learned: [], desktopAi: null, ...state});
  setDesktopAiSeams({focusIsRead: () => true, answered: () => false, answerEntry: (...given) => calls.push(['answer', ...given]), toast: (...given) => calls.push(['toast', ...given]), ...seams});
};

test('the offer needs all four: the app, an open learned question, Focus read, and no Not now', () => {
  set({desktopAi: {family: 'claude'}, learned});
  assert.equal(offered(), true);
  set({desktopAi: null, learned});
  assert.equal(offered(), false, 'no desktop app: nothing');
  set({desktopAi: {family: 'claude'}, learned: []});
  assert.equal(offered(), false, 'no open learned question: nothing');
  set({desktopAi: {family: 'claude'}, learned}, {focusIsRead: () => false});
  assert.equal(offered(), false, 'Focus not read yet: a hidden card cannot be told from a new one (#2366)');
  set({desktopAi: {family: 'claude'}, learned}, {answered: key => key === KEY});
  assert.equal(offered(), false, 'Not now: hidden');
  assert.equal(desktopAiBanner(), null);
});

test('the banner: the press copies and says what happened in its own line; Not now removes it and keeps the answer under the shared key', async () => {
  set({desktopAi: {family: 'claude'}, learned});
  calls.length = 0;
  const box = document.createElement('div');
  document.body.append(box);
  const banner = desktopAiBanner();
  box.append(banner);
  assert.equal(banner.querySelector('b').textContent, 'Let Claude answer your questions');
  const copy = banner.querySelector('#desktop-ai-copy');
  assert.equal(copy.textContent, 'Copy the instruction and open Claude');
  copy.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['help']);
  assert.match(banner.querySelector('[role="status"]').textContent, /Claude is open.*Ctrl\+V/, 'it says it was copied and how to paste');
  banner.querySelector('#desktop-ai-later').click();
  assert.equal(box.querySelector('.qa-desktop-ai'), null, 'gone at once');
  assert.deepEqual(calls[1], ['answer', {key: KEY, title: 'Let Claude answer your questions'}, 'Not now']);
  box.remove();
});

test('a press that finds the app gone says nothing was copied, never "copied"', async () => {
  globalThis.window.pilot.desktopAiHelp = async () => ({ok: false, reason: 'none'});
  set({desktopAi: {family: 'openai'}, learned});
  const banner = desktopAiBanner();
  banner.querySelector('#desktop-ai-copy').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(banner.querySelector('[role="status"]').textContent, /ChatGPT is not on this computer any more\. Nothing was copied\./);
});

test('a press whose copy failed says so, and does not claim the app is gone', async () => {
  globalThis.window.pilot.desktopAiHelp = async () => ({ok: false, reason: 'error'});
  set({desktopAi: {family: 'claude'}, learned});
  const banner = desktopAiBanner();
  banner.querySelector('#desktop-ai-copy').click();
  await new Promise(resolve => setImmediate(resolve));
  const text = banner.querySelector('[role="status"]').textContent;
  assert.match(text, /Could not copy the instruction/);
  assert.doesNotMatch(text, /not on this computer/);
});

test('appendDesktopAiOffer puts the banner in a page only while it is offered', () => {
  set({desktopAi: {family: 'claude'}, learned});
  const into = document.createElement('div');
  appendDesktopAiOffer(into);
  assert.equal(into.querySelectorAll('.qa-desktop-ai').length, 1);
  set({desktopAi: null, learned});
  const empty = document.createElement('div');
  appendDesktopAiOffer(empty);
  assert.equal(empty.querySelectorAll('.qa-desktop-ai').length, 0);
});

test('Focus and the Jobs bar get one row with the same words and button, only while learned questions are open', () => {
  const rows = questionEntries({learned, desktopAi: {family: 'openai'}});
  const row = rows.find(each => each.kind === 'desktop-ai');
  assert.ok(row, 'the row');
  assert.deepEqual([row.key, row.title, row.actions, row.answers], [KEY, 'Let ChatGPT answer your questions', [{label: 'Copy the instruction and open ChatGPT', do: 'copy_desktop_ai'}], ['Not now']]);
  assert.ok(QUESTION_DOES.includes('copy_desktop_ai'));
  assert.equal(questionEntries({learned: [], desktopAi: {family: 'openai'}}).some(each => each.kind === 'desktop-ai'), false);
  assert.equal(questionEntries({learned}).some(each => each.kind === 'desktop-ai'), false, 'no app: no row');
});

test('⌘K lists it while it is offered, and its run presses the same button', async () => {
  set({desktopAi: {family: 'claude'}, learned});
  const added = [];
  addDesktopAiCommands((...given) => added.push(given));
  assert.equal(added.length, 1);
  assert.equal(added[0][1], 'Let Claude answer your questions');
  set({desktopAi: null, learned});
  const none = [];
  addDesktopAiCommands((...given) => none.push(given));
  assert.deepEqual(none, []);
});

test('the words stay inside what the drawer\'s checks give: the instruction never asks for a Submit or a Settings change', () => {
  assert.match(instruction(), /Never press Submit on any job\. Do not change Settings\./);
  assert.doesNotMatch(JSON.stringify(words('claude')), /\?/, 'no question mark in the interface words');
});
