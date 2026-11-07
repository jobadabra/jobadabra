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
