// Tester mode (lib/tester-mode.js) and the tester send (lib/feedback-handlers.js sendTesterBug).
// Guard: privacy — a real person's app is never in tester mode, and a tester's bug never reaches the real feedback box (/api/feedback) or its counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {testerMode} from '../../../lib/tester-mode.js';
import {registerFeedbackHandlers} from '../../../lib/feedback-handlers.js';

test('a real person\'s app is never in tester mode, whatever the variables say', () => {
  assert.equal(testerMode({}), null);
  assert.equal(testerMode({JOBADABRA_TESTER: 'persona', JOBADABRA_TESTER_KEY: 'k'}), null, 'persona only inside the e2e test app');
  assert.equal(testerMode({JOBADABRA_TESTER: 'desktop-tester', JOBADABRA_TESTER_KEY: 'k'}), null, 'desktop-tester only inside the twin');
  assert.equal(testerMode({JOBADABRA_TESTER: 'persona', JOBADABRA_E2E: '1'}), null, 'no key');
  assert.equal(testerMode({JOBADABRA_TESTER: 'admin', JOBADABRA_TESTER_KEY: 'k', JOBADABRA_E2E: '1', JOBADABRA_TWIN: '1'}), null, 'an unknown word');
  assert.equal(testerMode({JOBADABRA_TESTER: 'persona', JOBADABRA_TESTER_KEY: 'k', JOBADABRA_TWIN: '1'}), null, 'the persona word in a twin');
});

test('the test app and the twin are tester apps', () => {
  assert.deepEqual(testerMode({JOBADABRA_TESTER: 'persona', JOBADABRA_TESTER_KEY: 'k', JOBADABRA_E2E: '1'}), {source: 'persona', key: 'k'});
  assert.deepEqual(testerMode({JOBADABRA_TESTER: 'desktop-tester', JOBADABRA_TESTER_KEY: 'k', JOBADABRA_TWIN: '1'}), {source: 'desktop-tester', key: 'k'});
});

const handlers = {};
const image = {isEmpty: () => false, getSize: () => ({width: 800, height: 500}), resize: () => image, toJPEG: () => Buffer.from('jpeg-bytes')};
const win = {isDestroyed: () => false, webContents: {capturePage: async () => image}};
const app = {getVersion: () => '0.9.12', getLocale: () => 'en-GB', getPath: () => '/nonexistent-userdata'};
const storage = {settings: () => ({theme: 'dark', telemetryId: 'install-aaaa'}), secret: () => '', saveSettings: () => {}, readText: () => '[]'};
const INPUT = {title: 'Phone label', journey: 'J12', severity: 'high', expected: 'typed phone', seen: 'label shown', steps: 'Open Profile\nPress Save'};
const setup = extra => registerFeedbackHandlers({DEMO: false, app, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, storage, track: () => {}, getWindow: () => win, getPlan: () => ({state: () => ({plan: 'free'})}), jobsOf: async () => ({jobs: []}), ...extra});

test('in a person\'s app the tester send refuses, nothing is uploaded and the dialog is told nothing', async () => {
  const uploads = [];
  setup({tester: () => null, upload: async call => { uploads.push(call); return {ok: true}; }});
  assert.equal((await handlers.feedbackPrepare({}, 'actions')).tester, null);
  assert.equal((await handlers.sendTesterBug({}, INPUT)).ok, false);
  assert.equal(uploads.length, 0);
});

test('a tester send files one bundle to the tester route only: no /api/feedback call, a redacted log window, the key only as the bearer', async () => {
  const urls = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { urls.push({url: String(url), init}); return Response.json({ok: true, id: '0123456789abcdef', url: 'https://www.jobadabra.top/admin/bug-bundle/0123456789abcdef'}); };
  try {
    setup({tester: () => ({source: 'persona', key: 'SECRET-KEY'})});
    assert.equal((await handlers.feedbackPrepare({}, 'actions')).tester, 'persona');
    const result = await handlers.sendTesterBug({}, INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.id, '0123456789abcdef');
  } finally { globalThis.fetch = realFetch; }
  assert.equal(urls.length, 1);
  assert.equal(urls[0].url, 'https://www.jobadabra.top/agent/bundle');
  assert.ok(!urls.some(call => call.url.includes('/api/feedback')));
  assert.equal(urls[0].init.headers.Authorization, 'Bearer SECRET-KEY');
  const body = JSON.parse(urls[0].init.body);
  assert.equal(body.source, 'persona');
  assert.ok(!urls[0].init.body.includes('SECRET-KEY'), 'the key travels only in the header');
  assert.deepEqual(body.report.steps, ['Open Profile', 'Press Save']);
  assert.match(body.files['app.jpg'], /^data:image\/jpeg;base64,/);
  assert.match(body.files['logs.txt'], /== Support state ==\nversion: 0\.9\.12/);
  assert.equal(JSON.parse(body.files['env.json']).appVersion, '0.9.12');
});

test('a report without expected and seen, or with a bad severity, is refused before anything leaves; demo mode sends nothing', async () => {
  const uploads = [];
  setup({tester: () => ({source: 'persona', key: 'k'}), upload: async call => { uploads.push(call); return {ok: true}; }});
  await handlers.feedbackPrepare({}, '');
  assert.equal((await handlers.sendTesterBug({}, {...INPUT, expected: ''})).ok, false);
  assert.equal((await handlers.sendTesterBug({}, {...INPUT, severity: 'urgent'})).ok, false);
  assert.equal((await handlers.sendTesterBug({}, {...INPUT})).ok, true);
  assert.equal(uploads.length, 1);
  setup({DEMO: true, tester: () => ({source: 'persona', key: 'k'}), upload: async call => { uploads.push(call); return {ok: true}; }});
  assert.equal((await handlers.sendTesterBug({}, INPUT)).ok, false);
  assert.equal(uploads.length, 1);
});

test('in a tester app the real feedback send refuses even if the dialog fell back to the person form; a second tester send needs a new open', async () => {
  const urls = [], realFetch = globalThis.fetch;
  globalThis.fetch = async url => { urls.push(String(url)); return Response.json({ok: true, id: '0123456789abcdef', url: 'u'}); };
  try {
    setup({tester: () => ({source: 'persona', key: 'k'})});
    await handlers.feedbackPrepare({}, '');
    const real = await handlers.sendFeedback({}, 'words', '', {screenshot: true, logs: true});
    assert.equal(real.ok, false);
    assert.equal(urls.length, 0, 'nothing reached /api/feedback');
    assert.equal((await handlers.sendTesterBug({}, INPUT)).ok, true);
    assert.match((await handlers.sendTesterBug({}, INPUT)).error, /Open Send feedback first/);
  } finally { globalThis.fetch = realFetch; }
});
