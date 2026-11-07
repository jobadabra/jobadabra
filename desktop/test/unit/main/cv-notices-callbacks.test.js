// Guard: money/data — real CV IPC callbacks localize without reaching live AI, files, accounts or the browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {test, beforeEach, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';

const state = globalThis.__cvNoticesTest = {trips: [], client: null, base: null, saved: null, record: null, raw: '', calls: []};
const trip = name => { state.trips.push(name); throw new Error(`Forbidden test service: ${name}`); };
const sources = {
  'cv-import-at-upload.js': 'export const ensure = () => globalThis.__cvNoticesTrip("CV import"); export const setBuiltCv = () => globalThis.__cvNoticesTrip("CV write");',
  'claude-code.js': 'export const client = () => globalThis.__cvNoticesTest.client;',
  'contact.js': 'export const read = () => globalThis.__cvNoticesTrip("contact read");',
  'cv-check.js': 'export const saved = () => globalThis.__cvNoticesTest.saved; export const review = () => globalThis.__cvNoticesTrip("AI review");',
  'cv-look.js': 'export const probeWindow = () => {throw new Error(globalThis.__cvNoticesTest.raw);};',
  'cv.js': 'export const MODEL="fake-model"; export const usd=()=>0; export const baseCv=()=>globalThis.__cvNoticesTest.base; export const dir=()=>globalThis.__cvNoticesTrip("CV directory");',
  'demo.js': 'export const TEXT="Demo mode: nothing is saved.";',
  'files.js': 'export const coverLetterToProfile=()=>globalThis.__cvNoticesTrip("Notion write");',
  'letter-availability.js': 'export const availableLetter=()=>globalThis.__cvNoticesTrip("letter availability");',
  'cover-letter.js': 'export const load=()=>globalThis.__cvNoticesTest.record; export const edit=()=>globalThis.__cvNoticesTrip("letter edit"); export const generate=()=>globalThis.__cvNoticesTrip("letter AI");',
  'match-check.js': 'export const check=()=>globalThis.__cvNoticesTrip("match AI");',
  'experience.js': 'export const knownText=()=>globalThis.__cvNoticesTrip("experience read");',
  'pipeline.js': 'export const posting=()=>globalThis.__cvNoticesTrip("pipeline");',
  'server.js': 'export const pageKey=x=>x;',
  'strategy.js': 'export const profileTexts=()=>globalThis.__cvNoticesTrip("profile read");',
  'log.js': 'export const log=()=>{};',
  'tailored-restart.js': 'export const restartFormsOf=()=>globalThis.__cvNoticesTrip("restart form");',
  'private-file.js': 'export const writePrivate=()=>globalThis.__cvNoticesTrip("write private");',
  'letter-style.js': 'export const read=()=>globalThis.__cvNoticesTrip("letter style read"); export const saveEdit=()=>globalThis.__cvNoticesTrip("letter style write");',
  'ai/anthropic-api.js': 'export const anthropicApi=()=>globalThis.__cvNoticesTrip("live AI client");',
  'ai/names.js': 'export const nameOfClient=()=>"Provider {error} Mac ⌘K";',
};
globalThis.__cvNoticesTrip = trip;
registerHooks({load(url, context, next) {
  for (const [name, source] of Object.entries(sources)) if (url === new URL(`../../../lib/${name}`, import.meta.url).href) return {format: 'module', shortCircuit: true, source};
  return next(url, context);
}});
const {registerCvAndLettersHandlers} = await import('../../../lib/cv-handlers.js');
const {registerCvBuildHandlers} = await import('../../../lib/cv-build-handlers.js');
let dir, key, handles;
function register() {
  const storage = {path: name => path.join(dir, name), secret: () => key, settings: () => ({})};
  const ctx = {storage, ipcMain: {handle: (name, fn) => handles.set(name, fn)},
    handleImportant: (name, label, fn) => handles.set(name, fn), DEMO: false, BrowserWindow: {}, tailoring: new Set(),
    printPdf: () => trip('print PDF'), shell: {openPath: () => trip('open file'), showItemInFolder: () => trip('show file')},
    dialog: {showSaveDialog: () => trip('native dialog')}, getWindow: () => null, syncCv: () => trip('sync CV')};
  registerCvAndLettersHandlers(ctx); registerCvBuildHandlers(ctx);
}
beforeEach(() => {
  Object.assign(state, {trips: [], client: null, base: null, saved: null, record: null, raw: '', calls: []});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cv-notices-')); key = ''; handles = new Map(); setLocale('en'); register();
});
afterEach(() => {
  fs.rmSync(dir, {recursive: true, force: true}); setLocale('en');
  assert.deepEqual(state.trips, [], 'tripwires checked outside caught IPC callbacks');
});
const invoke = (name, ...args) => handles.get(name)(null, ...args);

test('registered CV callbacks resolve the active locale at invocation, retaining error shapes and gates', async () => {
  for (const name of ['matchCheck', 'cvCheckAi', 'importCv', 'coverLetterDraft', 'buildCvDraft']) {
    assert.deepEqual(await invoke(name), {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'});
    setLocale('de');
    assert.deepEqual(await invoke(name), {ok: false, error: 'Wählen Sie zuerst Ihre KI unter Einstellungen → Verbindungen → KI.'});
    setLocale('en');
  }
  assert.deepEqual(state.trips, []);
});

test('CV prerequisite checks translate after registration without starting import, review or PDF work', async () => {
  key = 'fake-key'; setLocale('de');
  for (const name of ['matchCheck', 'cvCheckRun']) assert.deepEqual(await invoke(name), {ok: false, error: 'Fügen Sie zuerst Ihren Lebenslauf (PDF oder Word) in den Einstellungen hinzu.'});
  for (const name of ['importCv', 'coverLetterDraft']) assert.deepEqual(await invoke(name), {ok: false, error: 'Fügen Sie zuerst Ihren Lebenslauf (PDF oder Word) hinzu.'});
  assert.deepEqual(await invoke('cvCheckAi'), {ok: false, error: 'Prüfen Sie zuerst den Lebenslauf.'});
  assert.deepEqual(await invoke('viewBaseCv'), {ok: false, error: 'Noch kein Basislebenslauf vorhanden.'});
  assert.deepEqual(await invoke('coverLetterApprove'), {ok: false, error: 'Schreiben oder erstellen Sie zuerst ein Anschreiben.'});
  assert.deepEqual(await invoke('buildCvSave', null), {ok: false, error: 'Es gibt noch nichts zu speichern.'});
});

test('parser failure translates its wrapper while the original error interpolates exactly once', async () => {
  fs.writeFileSync(path.join(dir, 'cv.pdf'), 'fictional PDF marker');
  state.raw = 'Provider {error} Mac ⌘K /private/fictional.pdf'; setLocale('ru');
  assert.deepEqual(await invoke('cvCheckRun'), {ok: false, error: `Не удалось прочитать резюме: ${state.raw}`});
});

test('real build callback validates before AI and keeps generated content and document language original', async () => {
  state.client = {messages: {create: async request => {state.calls.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({summary: 'Original summary {name}', roles: [{index: 0, bullets: ['Original work']}], skills: 'Original skills'})}], usage: {}}; }}};
  const answers = {name: 'Fictional {name} Mac', jobs: [{company: 'Example Employer', title: 'Original title', from: '2020'}]};
  setLocale('de');
  assert.deepEqual(await invoke('buildCvDraft', {...answers, name: ''}), {ok: false, error: 'Geben Sie Ihren Namen ein.'});
  assert.equal(state.calls.length, 0);
  const result = await invoke('buildCvDraft', answers);
  assert.equal(result.ok, true); assert.equal(result.cv.name, answers.name);
  assert.equal(result.cv.summary, 'Original summary {name}');
  assert.equal(result.cv.jobs[0].roles[0].period, '2020 – Present');
  assert.equal(result.cv.jobs[0].roles[0].title, 'Original title');
  assert.equal(state.calls.length, 1);
  assert.match(state.calls[0].system, /Write in the language of their answers\./);
});

test('a model refusal translates only app wording and preserves the provider name', async () => {
  state.client = {messages: {create: async () => ({stop_reason: 'refusal'})}}; setLocale('de');
  const result = await invoke('buildCvDraft', {name: 'Fictional', jobs: [{company: 'Example', title: 'Role'}]});
  assert.deepEqual(result, {ok: false, error: 'Provider {error} Mac ⌘K hat das Schreiben dieses Lebenslaufs abgelehnt'});
});

test('all seven languages reach the real validation callbacks with the same gates and shapes', async () => {
  const names = {en: 'Add your name.', de: 'Geben Sie Ihren Namen ein.', fr: 'Indiquez votre nom.', it: 'Inserisci il tuo nome.', es: 'Añade tu nombre.', ro: 'Adaugă numele tău.', ru: 'Укажите своё имя.'};
  const {cvNotice} = await import('../../../i18n/cv-notices.js');
  state.client = {messages: {create: () => trip('AI during invalid draft')}};
  const job = {company: 'Original {provider} company', title: 'Original title'};
  for (const [locale, expected] of Object.entries(names)) {
    setLocale(locale);
    assert.deepEqual(await invoke('buildCvDraft', {name: '', jobs: [job]}), {ok: false, error: expected});
    for (const [jobs, message] of [[[], 'addJob'], [Array.from({length: 9}, () => job), 'maxJobs'], [[{company: 'Original company'}], 'jobNeeds']]) {
      assert.deepEqual(await invoke('buildCvDraft', {name: 'Fictional', jobs}), {ok: false, error: cvNotice(message, {limit: 8})});
    }
  }
});

test('unwrapped provider failures retain their original error and callback return shape', async () => {
  const raw = 'Provider отказ {error} Mac ⌘K';
  state.client = {messages: {create: async () => {throw new Error(raw);}}}; setLocale('fr');
  assert.deepEqual(await invoke('buildCvDraft', {name: 'Fictional', jobs: [{company: 'Example', title: 'Role'}]}), {ok: false, error: raw});
});
