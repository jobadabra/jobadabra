// Waiting application journey: the sender supplies a frame button whose link selects Applying after desktop startup.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {createWaitingMessage} from '../../../lib/waiting-message.js';
import {refreshLanguage, sendEmail} from '../../../lib/notify-channel.js';
import {installAppLinks} from '../../../lib/app-links.js';

test('scenario: application waits -> branded email button -> desktop opens Applying without starting work', async () => {
  let flush; const requests = [];
  const storage = {settings: () => ({notifyEmail: 'fictional@example.com'}), secret: () => 'JPF1.fixture.test', saveSettings() {}};
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
    requests.push({path, method: init.method, body});
    return {json: async () => ({ok: true, ...(path === '/api/account/language' ? {language: body.language} : {})})};
  };
  const message = createWaitingMessage(storage, {channels: () => ['email'], log() {}, setTimer: fn => { flush = fn; },
    sendEmail: mail => sendEmail(storage, {...mail, urgent: true}, fetcher)});
  message.add({id: 'fictional', title: 'Platform Engineer', company: 'Example Airlines', note: 'Review and submit this form yourself.'});
  await flush();
  await refreshLanguage(storage, fetcher);   // settle queued metadata using the same fake transport, never a live fallback
  assert.deepEqual(requests.map(request => request.path), ['/api/notify/email', '/api/account/language'], 'only delivery and its metadata refresh occur');
  const deliveries = requests.filter(request => request.path === '/api/notify/email');
  assert.equal(deliveries.length, 1, 'exactly one email delivery, independently of metadata refresh');
  const payload = deliveries[0].body;
  assert.equal(payload.kind, 'urgent'); assert.equal(payload.language, 'en');
  assert.deepEqual(requests.filter(request => request.path === '/api/account/language'), [{path: '/api/account/language', method: 'PUT', body: {language: 'en'}}]);
  assert.equal(payload.subject, '1 application is waiting for you');
  assert.equal(payload.buttons[0].text, 'Open in Jobadabra');
  assert.equal(payload.buttons[0].url, 'https://www.jobadabra.top/open?view=sessions');
  assert.doesNotMatch(payload.html, /Open Jobadabra to finish|1 application is waiting/);
  const app = new EventEmitter(), ipcMain = new EventEmitter(), shown = [], webContents = {};
  const window = {webContents, isDestroyed: () => false, isMinimized: () => false, show() {}, focus() {}};
  app.whenReady = () => Promise.resolve();
  installAppLinks({app, ipcMain, argv: ['jobadabra://sessions'], getWindow: () => window, createWindow() { throw new Error('startup owns the first window'); }, toWindow: (...args) => shown.push(args)});
  await Promise.resolve();
  assert.deepEqual(shown, [], 'wait until the renderer is listening');
  ipcMain.emit('appLinksReady', {sender: webContents});
  assert.deepEqual(shown, [['openTarget', {view: 'sessions'}]], 'navigation is the only action');
});
