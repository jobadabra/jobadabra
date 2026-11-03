// The tester's steps (Windows, 0.9.2, issue #3055): 8 CV versions already added, press "Add another CV version", choose a PDF.
// The window must be told why nothing was added. Plays the real handler (lib/experience-handlers.js) over a real store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cv from '../lib/cv.js';
import * as experience from '../lib/experience.js';
import {registerExperienceHandlers} from '../lib/experience-handlers.js';
import {createStorage} from '../lib/storage.js';

const MAIN = {name: 'Ada Example', skills: 'AWS', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Ran incidents.']}]}]};
const OTHER = {name: 'Ada Example', skills: 'AWS', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Ran incidents.', 'Built pipelines.']}]}]};
const ANSWER = {roles: [{source_role: 0, main_job: 0, main_role: 0, new_bullets: [1]}]};
const client = {messages: {create: async request => ({stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1},
  content: [{type: 'text', text: JSON.stringify(/compare/.test(request.system) ? ANSWER : OTHER)}]})}};
const pdf = () => { const file = path.join(os.tmpdir(), `lim-${Math.random().toString(36).slice(2)}.pdf`); fs.writeFileSync(file, `%PDF ${Math.random()}`); return file; };

test('adding a 9th CV version answers with the limit in words, and says nothing was added', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-lim-')), {encrypt: v => v, decrypt: v => v});
  fs.mkdirSync(cv.dir(storage), {recursive: true});
  fs.writeFileSync(path.join(cv.dir(storage), 'cv.json'), JSON.stringify(MAIN));
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-test');
  for (let i = 0; i < experience.MAX_SOURCES; i++) await experience.addCv(storage, pdf(), `CV ${i + 1}`, {client});
  const handlers = {}, steps = []; let opened = 0;
  registerExperienceHandlers({DEMO: false, storage, shell: {}, getWindow: () => ({isDestroyed: () => false, webContents: {send: (name, step) => steps.push(step)}}),
    dialog: {showOpenDialog: async () => { opened += 1; return {canceled: false, filePaths: [pdf()]}; }}, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}});
  const answer = await handlers.experienceAddCv();
  assert.equal(answer.ok, false);
  assert.match(answer.error, /Up to 8 extra CV versions: remove one first/, 'the window gets the words');
  assert.equal(answer.sources.length, 8, 'and the 8 versions are still there');
  assert.equal(opened, 0, 'the file picker never opens: the person is told before choosing a PDF');
});

test('the answer to "Add another CV version" sits under its buttons, above the lists that grow with each version', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const panel = html.slice(html.indexOf('id="setting-experience-sources"'), html.indexOf('id="setting-experience-profile"'));
  const at = id => panel.indexOf(`id="${id}"`);
  assert.ok(at('exp-add') > 0 && at('exp-message') > 0, 'the panel has the button and the message');
  for (const list of ['exp-sources', 'exp-versions']) assert.ok(at('exp-message') < at(list), `the message is above ${list}: at 8 versions it was below the fold`);
});
