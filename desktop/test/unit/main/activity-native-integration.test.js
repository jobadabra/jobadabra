// Actual producer callbacks localize native text while leaving control notes, external messages and targets unchanged.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {SUPPORTED_LOCALES, setLocale} from '../../../i18n/index.js';
import {activityText, activityHandoff} from '../../../i18n/activity-notices.js';
import {registerInterviewHandlers} from '../../../lib/interview-handlers.js';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';

afterEach(() => setLocale('en'));

test('actual transcription callback keeps raw titles and the Interviews destination in all seven locales', async () => {
  const handlers = {}, notices = [], raw = 'Fictional {title} this Mac Keychain ⌘K <raw>';
  let meta = {status: 'ready', title: raw}, store = 'sqlite';
  registerInterviewHandlers({ipcMain: {handle: (name, fn) => {handlers[name] = fn;}},
    handleImportant: (name, _label, fn) => {handlers[name] = fn;}, sharedRead: (_name, fn) => fn,
    interviews: {transcribe: async () => meta}, notify: (...args) => notices.push(args),
    storage: {settings: () => ({store})}, toWindow: () => assert.fail('transcriber emitted no progress')});
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    for (const selected of ['sqlite', 'notion']) for (const saved of [false, true]) {
      store = selected;
      meta = {...meta, pageId: saved ? 'fictional-page' : ''};
      assert.equal(await handlers.ivTranscribe(null, 'fictional', {}), meta);
      assert.deepEqual(notices.at(-1), [activityText('transcriptTitle'), activityText(saved ? (store === 'notion' ? 'transcriptNotion' : 'transcriptSaved') : 'transcriptBody', {title: raw}), {view: 'interviews'}, 'good']);
      assert.ok(notices.at(-1)[1].includes(raw));
    }
  }
});

test('interrupted handoff translates only native copy; English control/email payload and reason remain intact', async () => {
  const raw = 'Fictional {company} this Mac Keychain ⌘K';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const notices = [], away = [], reports = [];
    const record = {id: `fictional-${locale}`, title: raw, company: raw, background: {}, outcome: '', startedAt: '2020-01-01T00:00:00Z'};
    const controller = createBackgroundApplyController({}, {started: Date.parse('2021-01-01T00:00:00Z'), store: {interrupted: async () => ({state: 'needs_user_handoff', session: record.id, reason: 'app_closed', mode: 'fill', manualOverride: true})},
      terminals: {list: () => [record], record: () => record, report: (_id, message) => reports.push(message)},
      config: () => ({mode: 'fill'}), notify: (...args) => notices.push(args), waiting: {add: item => away.push(item)}, log() {}});
    assert.deepEqual(await controller.sweepInterrupted(Date.parse('2021-01-01T00:00:00Z')), [record.id]);
    assert.deepEqual(notices, [[activityText('needsYou'), activityHandoff('app_closed', 'outcomeUnknown'), {view: 'sessions', session: record.id}, 'warn']]);
    const english = 'The app was closed while it held this application, so nothing was sent. Open it, check the form and submit it yourself.';
    assert.equal(away[0].note, english); assert.equal(reports[0].message, english);
    assert.equal(away[0].title, raw); assert.equal(away[0].company, raw);
    assert.equal(record.background.reason, 'app_closed'); assert.equal(record.background.state, 'needs_user_handoff');
  }
});

test('Ready callbacks localize display errors after registration without changing action flags or raw provider errors', async () => {
  const {registerReadyHandlers} = await import('../../../lib/ready-handlers.js');
  const {useKeychainReader} = await import('../../../lib/ready-site.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-ready-'));
  const handlers = {}, settings = {}, raw = 'Fictional {error} this Mac Keychain ⌘K';
  let jobs = [], response = {ok: true, jobs: []}, failure = raw;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(response), {status: 200});
  useKeychainReader(() => null); // The fake routes never read the owner's Keychain.
  try {
    registerReadyHandlers({ipcMain: {handle: (name, fn) => {handlers[name] = fn;}},
      storage: {settings: () => settings, saveSettings: patch => Object.assign(settings, patch),
        secret: name => /TRIAL/.test(name) ? 'JPF1.fictional.token' : '', path: name => path.join(dir, name)},
      deps: {jobs: async () => jobs, apply: {formUrl: value => value, applyOne: () => assert.fail('no page: no form opens')},
        prepare: {kit: async () => ({ok: false, error: failure}), cv: async () => ({ok: false, error: failure})}}});
    for (const locale of SUPPORTED_LOCALES) {
      setLocale(locale);
      assert.deepEqual(await handlers.readyOpen(null, 'missing'), {ok: false, error: activityText('jobMissing')});
      assert.deepEqual(await handlers.readyRun(null), {ok: false, nothing: true, error: activityText('nothingToFill')});
      jobs = [{code: 'fictional', url: 'https://fictional.example.test/job', title: raw, company: raw}];
      response = {ok: false, error: raw};
      assert.deepEqual(await handlers.readyOpen(null, 'fictional'), {...response, status: undefined}, 'provider error and upstream status field remain unchanged');
      response = {ok: true, jobs: []};
      assert.deepEqual(await handlers.readyOpen(null, 'fictional'), {ok: false, error: activityText('handoffPageMissing')});
      assert.deepEqual(await handlers.readyRun(null, {top: ['fictional']}), {ok: false, nothing: true, error: activityText('nothingPrepared', {error: raw})});
      failure = '';
      const name = `${raw} · ${raw}`;
      assert.deepEqual(await handlers.readyRun(null, {top: ['fictional']}), {ok: false, nothing: true,
        error: activityText('nothingPrepared', {error: activityText('applicationNotPrepared', {name})})});
      jobs[0].kit = true;
      assert.deepEqual(await handlers.readyRun(null, {top: ['fictional']}), {ok: false, nothing: true,
        error: activityText('nothingPrepared', {error: activityText('noCv', {name})})});
      jobs = []; failure = raw;
    }
  } finally {globalThis.fetch = previousFetch; fs.rmSync(dir, {recursive: true, force: true});}
});
