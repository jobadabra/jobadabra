// Guard: data/money — real editing callbacks preserve data and never reach live AI, Notion, browser or owner files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {test, beforeEach, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
const state = globalThis.__editNoticesTest = {trips: [], calls: [], record: null, saved: null, raw: '', dir: ''};
const trip = name => { state.trips.push(name); throw new Error(`Forbidden test service: ${name}`); };
globalThis.__editNoticesTrip = trip;
const sources = {
  'claude-code.js': 'export const client=()=>globalThis.__editNoticesTrip("AI client");',
  'contact.js': 'export const read=async()=>({full_name:"Original {name} Mac"});',
  'cv.js': 'export const baseCv=()=>({name:"Original CV"}); export const load=()=>null; export const forUrl=()=>globalThis.__editNoticesTrip("CV lookup");',
  'demo.js': 'export const jobLetter={text:"Fictional demo letter"};',
  'job-letter.js': `const s=globalThis.__editNoticesTest;
    export const load=()=>s.record; export const status=()=>s.saved||{text:s.record?.text};
    export const dir=()=>s.dir; export const html=(storage,text,contact,cv)=>{s.calls.push({kind:'html',text,contact,cv}); return '<p>Fictional letter</p>';};
    export const save=(storage,code,record,pdf)=>{s.saved={record,code,pdf};};
    export const pdfPath=()=>s.dir+'/fictional.pdf'; export const finalName=()=> 'Original letter.pdf';
    export const draft=()=>globalThis.__editNoticesTrip('letter AI'); export const hasPdf=()=>false;`,
  'job-page-handlers.js': 'export const jobPage=()=>globalThis.__editNoticesTrip("job page");',
  'pipeline.js': 'export const posting=()=>globalThis.__editNoticesTrip("pipeline");',
  'store/files.js': 'export const attachToJob=async(storage,url,file,options)=>{globalThis.__editNoticesTest.calls.push({kind:"attach",url,file,options});};',
  'log.js': 'export const log=(...args)=>globalThis.__editNoticesTest.calls.push({kind:"log",args});',
};
registerHooks({load(url, context, next) {
  for (const [name, source] of Object.entries(sources)) if (url === new URL(`../../../lib/${name}`, import.meta.url).href) return {format: 'module', shortCircuit: true, source};
  return next(url, context);
}});
const {registerTextOutlineHandlers} = await import('../../../lib/text-outline-handlers.js');
const {registerDraftEditHandlers} = await import('../../../lib/draft-edit-handlers.js');
const {registerJobLetterHandlers} = await import('../../../lib/job-letter-handlers.js');
let handles, page;
const invoke = (name, ...args) => handles.get(name)(null, ...args);
beforeEach(() => {
  Object.assign(state, {trips: [], calls: [], record: null, saved: null, raw: '', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-edit-notices-'))});
  handles = new Map(); setLocale('en');
  page = {outline: async () => [{id: 'L1', type: 'paragraph', text: 'Original {error} Mac'}],
    setText: async (block, text) => {state.calls.push({kind: 'text', block, text}); if (state.raw) throw new Error(state.raw);}};
  const ipcMain = {handle: (name, fn) => handles.set(name, fn)};
  const storage = {path: name => path.join(state.dir, name), secret: () => trip('secret'), settings: () => ({})};
  registerTextOutlineHandlers({ipcMain, storage, DEMO: false, log: (...args) => state.calls.push({kind: 'log', args}),
    open: () => ({page: () => page, label: 'Original store', textLink: () => 'https://example.test/original'})});
  registerDraftEditHandlers({ipcMain});
  registerJobLetterHandlers({ipcMain, storage, DEMO: false, shell: {openPath: () => trip('open file')},
    printPdf: async file => {state.calls.push({kind: 'print', file}); return {pdf: Buffer.from('fictional PDF')};}});
});
afterEach(() => {
  fs.rmSync(state.dir, {recursive: true, force: true}); setLocale('en');
  assert.deepEqual(state.trips, [], 'tripwires checked outside caught callbacks');
});

test('registered outline and draft callbacks resolve language when invoked', async () => {
  for (const [locale, error] of [['en', 'Nothing to save.'], ['de', 'Nichts zu speichern.'], ['ru', 'Нечего сохранять.']]) {
    setLocale(locale);
    assert.deepEqual(await invoke('textEdit', 'profile', []), {ok: false, error});
    assert.deepEqual(await invoke('draftTextEdit', 'Original document', []), {ok: false, error});
  }
  assert.deepEqual(state.calls, [], 'invalid changes never open/write/print');
});

test('concurrent outline edits report localized saved count while successful edits and response data remain original', async () => {
  setLocale('de');
  const result = await invoke('textEdit', 'profile', [{op: 'text', id: 'L1', was: 'Original {error} Mac', value: 'Original replacement {count}'}, {op: 'text', id: 'missing', value: 'unused'}]);
  assert.deepEqual(result, {ok: false, error: 'Einige Zeilen wurden inzwischen geändert (1 gespeichert). Der Tab zeigt den aktuellen Stand der Seite.',
    items: await page.outline(), store: 'Original store', link: 'https://example.test/original'});
  assert.equal(state.calls.find(call => call.kind === 'text').text, 'Original replacement {count}');
  assert.deepEqual(state.calls.find(call => call.kind === 'log').args, ['store', 'text edited', {name: 'profile', saved: 1, missing: 1}]);
});

test('draft conflicts localize while the original markdown, headings and outline stay unchanged', async () => {
  setLocale('de'); const markdown = '# Profile\n\nOriginal answer {count} Mac';
  const result = await invoke('draftTextEdit', markdown, [{op: 'text', id: 'missing', value: 'unused'}]);
  assert.equal(result.ok, false); assert.equal(result.markdown, markdown); assert.equal(result.saved, 0);
  assert.equal(result.store, 'draft'); assert.equal(result.link, null);
  assert.equal(result.error, 'Einige Zeilen wurden inzwischen geändert. Die Karte zeigt den aktuellen Stand des Entwurfs.');
  assert.deepEqual(result.items, (await invoke('draftTextOutline', markdown)).items);
});

test('save-error wrappers interpolate raw errors once and read errors remain raw', async () => {
  state.raw = 'Provider {error} Mac ⌘K /fictional'; setLocale('ru');
  assert.deepEqual(await invoke('textEdit', 'profile', [{op: 'text', id: 'L1', value: 'New original'}]), {ok: false, error: `Не сохранено: ${state.raw}`});
  page.outline = async () => {throw new Error(state.raw);};
  assert.deepEqual(await invoke('textOutline', 'profile'), {ok: false, error: state.raw});
});

test('missing and empty letter guards follow the active locale without PDF, writes or AI', async () => {
  setLocale('de');
  assert.deepEqual(await invoke('jobLetterSave', 'job1', 'Original'), {ok: false, error: 'Dieses Stellenangebot hat noch kein Anschreiben: Passen Sie zuerst den Lebenslauf an.'});
  state.record = {text: 'Original letter'};
  assert.deepEqual(await invoke('jobLetterSave', 'job1', ' '), {ok: false, error: 'Das Anschreiben ist leer.'});
  assert.deepEqual(await invoke('jobLetterAgain', 'job1'), {ok: false, error: 'Passen Sie zuerst den Lebenslauf für dieses Stellenangebot an.'});
  assert.deepEqual(state.calls, []);
});

test('successful real callbacks preserve original outline payload and letter text, metadata and file names', async () => {
  setLocale('ru');
  const outline = await invoke('textOutline', 'profile');
  assert.deepEqual(outline, {ok: true, items: await page.outline(), store: 'Original store', link: 'https://example.test/original'});
  const result = await invoke('textEdit', 'profile', [{op: 'text', id: 'L1', value: 'Original updated'}]);
  assert.deepEqual(result, {...outline, saved: 1});
  state.record = {job: {code: 'job1', company: 'Original Company', url: 'https://example.test/job'}, text: 'Old original', model: 'original-model'};
  const saved = await invoke('jobLetterSave', 'job1', 'Original {error} Mac\r\nSecond line');
  assert.equal(saved.ok, true); assert.equal(saved.record.text, 'Original {error} Mac\nSecond line');
  assert.equal(saved.record.model, 'original-model'); assert.deepEqual(saved.record.job, state.record.job);
  assert.equal(saved.record.source, 'you'); assert.deepEqual(saved.record.warnings, []);
  assert.deepEqual(state.calls.find(call => call.kind === 'attach').options, {name: 'Original letter.pdf'});
  assert.equal(state.calls.filter(call => call.kind === 'print').length, 1);
  assert.ok(state.calls.find(call => call.kind === 'print').file.startsWith(state.dir));
});

test('unknown text names remain canonical control validation in every language', async () => {
  for (const locale of ['en', 'de', 'ru']) {
    setLocale(locale);
    for (const name of ['textOutline', 'textEdit']) assert.deepEqual(await invoke(name, 'unknown'), {ok: false, error: 'No text called unknown'});
  }
});

test('every locale reaches the registered callbacks and saved-count plural branch', async () => {
  const words = {en: 'Nothing to save.', de: 'Nichts zu speichern.', fr: 'Rien à enregistrer.', it: 'Nulla da salvare.', es: 'Nada que guardar.', ro: 'Nimic de salvat.', ru: 'Нечего сохранять.'};
  const {editNotice} = await import('../../../i18n/edit-notices.js');
  for (const [locale, error] of Object.entries(words)) {
    setLocale(locale);
    assert.deepEqual(await invoke('textEdit', 'profile', []), {ok: false, error}, locale);
    for (const count of [0, 1, 2, 5, 21]) {
      const edits = [...Array.from({length: count}, () => ({op: 'text', id: 'L1', value: 'Original replacement'})), {op: 'text', id: 'missing', value: 'unused'}];
      const result = await invoke('textEdit', 'profile', edits);
      assert.equal(result.ok, false); assert.equal(result.error, editNotice('outlineChanged', {count}), `${locale}:${count}`);
      assert.equal(result.store, 'Original store');
      assert.equal(state.calls.filter(call => call.kind === 'text').length, count);
      state.calls.length = 0;
    }
  }
});

test('draft failures wrap their raw error once without leaking into saved content', async () => {
  const raw = 'Provider {error} Mac ⌘K';
  const change = {op: 'append', get lines() {throw new Error(raw);}};
  setLocale('de');
  assert.deepEqual(await invoke('draftTextEdit', 'Original document', [change]), {ok: false, error: `Nicht geändert: ${raw}`});
  assert.deepEqual(state.calls, []);
});
