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
  const handlers = {}, settings = {}, notices = [], raw = 'Fictional {error} this Mac Keychain ⌘K';
  let jobs = [], response = {ok: true, jobs: []}, failure = raw;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(response), {status: 200});
  useKeychainReader(() => null); // The fake routes never read the owner's Keychain.
  try {
    registerReadyHandlers({ipcMain: {handle: (name, fn) => {handlers[name] = fn;}}, notify: (...args) => notices.push(args),
      storage: {settings: () => settings, saveSettings: patch => Object.assign(settings, patch),
        secret: name => name === 'READY_OWNER_SECRET' ? 'fictional-owner' : /TRIAL/.test(name) ? 'JPF1.fictional.token' : '', path: name => path.join(dir, name)},
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
      settings.ready = {};
      response = {ok: true, jobs: [{state: 'prepared'}, {state: 'partial'}], batch: {night: `fictional-${locale}`}};
      const before = notices.length;
      assert.equal((await handlers.readyState()).owner, true);
      assert.deepEqual(notices.at(-1), [activityText('overnightTitle'), activityText('overnight', {count: 2, left: activityText('overnightLeft', {count: 1})}), {view: 'actions'}, 'good']);
      await handlers.readyState();
      assert.equal(notices.length, before + 1, 'the same night is still announced once');
      response = {ok: true, jobs: []};
    }
  } finally {globalThis.fetch = previousFetch; fs.rmSync(dir, {recursive: true, force: true});}
});

test('actual quit callback localizes its title while retaining the wait decision and app target', async () => {
  const {installQuitHandling} = await import('../../../lib/lifecycle.js');
  const {NO_PLACE} = await import('../../../renderer/targets.js');
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const notices = [], decisions = [];
    const beforeQuit = installQuitHandling({app: {on() {}, quit: () => assert.fail('unfinished work must not quit')}, platform: 'darwin',
      state: () => ({}), pipeline: {running: () => ({kind: 'search'}), queued: () => [], taskName: () => 'Fictional task', whenIdle: () => new Promise(() => {})},
      terminals: {running: () => [], list: () => [], label: () => 'Fictional task'}, shouldAskOnQuit: () => false,
      showDialog: (_parent, options) => {decisions.push(options); return 0;}, icon: () => ({}), getWindows: () => [],
      notify: (...args) => notices.push(args), log() {}});
    beforeQuit({preventDefault() {}});
    assert.equal(decisions[0].defaultId, 0); assert.equal(decisions[0].cancelId, 2);
    assert.deepEqual(notices, [[activityText('quitTitle'), decisions[0].detail, NO_PLACE.app, 'info']]);
  }
});

test('actual learned save emits a localized notice without AI, network or real profile data', async () => {
  const {save} = await import('../../../lib/learned.js');
  const {createStorage} = await import('../../../lib/storage.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-learned-'));
  const previousFetch = globalThis.fetch;
  const forbiddenCalls = [];
  const forbidden = (...args) => {forbiddenCalls.push(args); throw new Error('fictional network/AI call forbidden');};
  globalThis.fetch = forbidden;
  try {
    for (const locale of SUPPORTED_LOCALES) {
      setLocale(locale);
      const storage = createStorage(path.join(dir, locale), {encrypt: value => value, decrypt: value => value});
      storage.saveSettings({store: 'sqlite', telemetry: false});
      const notices = [], raw = '1 Fictional {value} Lane';
      const result = await save(storage, {items: [{label: 'Street', value: raw}]}, {
        notify: (...args) => notices.push(args), client: {messages: {create: forbidden}}, fetcher: forbidden});
      assert.deepEqual(forbiddenCalls, [], 'no attempted network/AI calls, even if production catches their errors');
      assert.deepEqual(result, {ok: true, count: 1});
      assert.deepEqual(notices, [[activityText('remembered', {count: 1}), activityText('learnedBody'), {view: 'settings', section: 'profile'}, 'good']]);
      assert.ok(storage.readText('profile.md').includes(raw));
      if (locale !== 'en') assert.notEqual(notices[0][0], 'Remembered 1 answer');
    }
  } finally {globalThis.fetch = previousFetch; fs.rmSync(dir, {recursive: true, force: true});}
});
