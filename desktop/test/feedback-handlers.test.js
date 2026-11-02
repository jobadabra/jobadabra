// Send feedback in the main process (lib/feedback-handlers.js): opening takes the picture and builds the logs once; sending uses that held copy, only for the parts left on, and
// demo mode sends nothing. Electron, the window and the site are fakes; nothing reaches the owner's logs or the real site.
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerFeedbackHandlers} from '../lib/feedback-handlers.js';

const handlers = {};
const image = {isEmpty: () => false, getSize: () => ({width: 800, height: 500}), resize: () => image, toJPEG: () => Buffer.from('jpeg-bytes')};
const win = {isDestroyed: () => false, webContents: {capturePage: async () => image}};
const app = {getVersion: () => '0.5.71', getLocale: () => 'en-GB', getPath: () => '/nonexistent-userdata'};
const storage = {settings: () => ({theme: 'dark', telemetryId: 'install-aaaa-bbbb'}), secret: () => '', saveSettings: () => {}, readText: () => '[]'};
const setup = (extra = {}) => {
  const tracked = [];
  registerFeedbackHandlers({DEMO: false, app, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, storage, track: (...args) => tracked.push(args), getWindow: () => win, getPlan: () => ({state: () => ({plan: 'free'})}), ...extra});
  return tracked;
};

test('opening holds a picture and the logs; sending uses exactly those, and only the parts left on', async () => {
  const tracked = setup();
  const prepared = await handlers.feedbackPrepare({}, 'actions');
  assert.match(prepared.shot.dataUrl, /^data:image\/jpeg;base64,/);
  assert.match(prepared.logs.text, /== Support state ==\nversion: 0\.5\.71/);
  assert.match(prepared.logs.text, /screen: actions/);
  assert.match(prepared.logs.text, /extensionPaired: false/);
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ok: true}); };
  try {
    assert.equal((await handlers.sendFeedback({}, 'words', '', {screenshot: false, logs: true})).ok, true);
    await handlers.feedbackPrepare({}, 'jobs');
    assert.equal((await handlers.sendFeedback({}, 'words', '', {screenshot: true, logs: false})).ok, true);
  } finally { globalThis.fetch = realFetch; }
  assert.ok(!('screenshot' in bodies[0])); assert.equal(bodies[0].logs, prepared.logs.text);
  assert.equal(bodies[0].screen, 'actions');
  assert.match(bodies[1].screenshot, /^data:image\/jpeg/); assert.ok(!('logs' in bodies[1])); assert.equal(bodies[1].screen, 'jobs');
  assert.deepEqual(tracked[0], ['feedback_sent', {screenshot: false, logs: true}]);
});

test('a window that cannot be captured still sends the note; demo mode sends nothing', async () => {
  setup({getWindow: () => ({isDestroyed: () => false, webContents: {capturePage: async () => { throw new Error('gone'); }}})});
  assert.equal((await handlers.feedbackPrepare({}, '')).shot, null);
  setup({DEMO: true});
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return Response.json({ok: true}); };
  try { assert.deepEqual(await handlers.sendFeedback({}, 'words', '', {screenshot: true, logs: true}), {ok: true}); } finally { globalThis.fetch = realFetch; }
  assert.equal(called, false);
});
