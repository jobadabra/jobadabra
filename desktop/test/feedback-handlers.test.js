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
const PAGE = {screen: 'jobs', source: 'registry', data: {view: {filters: ['inbound'], sort: 'best'}, jobs: [{id: 'j1', title: 'Designer', company: 'Acme'}], note: 'mail ana@example.org key sk-ant-api03-FAKEFAKEFAKEFAKEFAKE1234567890'}};
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
  assert.deepEqual(tracked[0], ['feedback_sent', {screenshot: false, logs: true, page: false, profile: false}]);
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

test('the screen data is held redacted at open and sent only when it is left on; the identity block is what is always sent', async () => {
  setup();
  const prepared = await handlers.feedbackPrepare({}, 'jobs', PAGE);
  assert.match(prepared.page.text, /"id": "j1"/); assert.match(prepared.page.text, /"filters": \[\n\s+"inbound"/);
  assert.ok(!prepared.page.text.includes('ana@example.org') && !prepared.page.text.includes('sk-ant'), 'the redactor ran over the page data');
  assert.deepEqual(Object.keys(prepared.identity).sort(), ['email', 'install', 'platform', 'version']);
  assert.equal(prepared.identity.install, 'install-aaaa-bbbb'); assert.match(prepared.identity.platform, new RegExp(`^${process.platform} \\S+ ${process.arch}$`));
  const bodies = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ok: true}); };
  try {
    await handlers.sendFeedback({}, 'words', '', {page: true});
    await handlers.feedbackPrepare({}, 'jobs', PAGE);
    await handlers.sendFeedback({}, 'words', '', {page: false});
  } finally { globalThis.fetch = realFetch; }
  assert.equal(bodies[0].page, prepared.page.text); assert.ok(!('page' in bodies[1]));
  assert.equal(bodies[0].platform, prepared.identity.platform);
});

test('the Profile snapshot is read only when asked, held redacted, and sent only when it is on; a failed read sends nothing', async () => {
  let reads = 0;
  setup({profileOf: async () => { reads++; return {reader: 'portrait', parts: {details: [{label: 'E-mail', value: 'ana@example.org'}, {label: 'City', value: 'Porto'}]}, lacked: ['voice']}; }});
  await handlers.feedbackPrepare({}, 'jobs', PAGE);
  assert.equal(reads, 0);   // opening the dialog never reads the Profile
  const {profile} = await handlers.feedbackProfile();
  assert.equal(reads, 1); assert.match(profile.text, /Porto/); assert.ok(!profile.text.includes('ana@example.org'));
  assert.deepEqual(profile.parts, ['details']);
  const bodies = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ok: true}); };
  try {
    await handlers.sendFeedback({}, 'words', '', {profile: true});
    await handlers.feedbackPrepare({}, 'jobs', PAGE);   // a new open forgets the old snapshot
    await handlers.sendFeedback({}, 'words', '', {profile: true});
    setup({profileOf: async () => { throw new Error('store down'); }});
    await handlers.feedbackPrepare({}, 'jobs', PAGE);
    assert.deepEqual(await handlers.feedbackProfile(), {profile: null});
    await handlers.sendFeedback({}, 'words', '', {profile: true});
  } finally { globalThis.fetch = realFetch; }
  assert.equal(bodies[0].profile, profile.text); assert.ok(!('profile' in bodies[1])); assert.ok(!('profile' in bodies[2]));
});

test('a Send while the Profile is being read leaves the old dialog alone: the late read neither throws nor lands on a new dialog', async () => {
  let release;
  setup({profileOf: () => new Promise(resolve => { release = () => resolve({reader: 'portrait', parts: {details: [{label: 'City', value: 'Porto'}]}, lacked: []}); })});
  await handlers.feedbackPrepare({}, 'jobs', PAGE);
  const late = handlers.feedbackProfile();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ok: true});
  try { await handlers.sendFeedback({}, 'words', '', {profile: true}); } finally { globalThis.fetch = realFetch; }   // sent while the read is pending: no snapshot, held is cleared
  release();
  assert.match((await late).profile.text, /Porto/);   // resolves for its own dialog, no TypeError
  await handlers.feedbackPrepare({}, 'jobs', PAGE);   // a new dialog starts without the old snapshot
  const bodies = [];
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ok: true}); };
  try { await handlers.sendFeedback({}, 'words', '', {profile: true}); } finally { globalThis.fetch = realFetch; }
  assert.ok(!('profile' in bodies[0]));
});
