// Waiting application journey: the sender supplies a frame button whose link selects Applying after desktop startup.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {createWaitingMessage} from '../../../lib/waiting-message.js';
import {sendEmail} from '../../../lib/notify-channel.js';
import {installAppLinks} from '../../../lib/app-links.js';

test('scenario: application waits -> branded email button -> desktop opens Applying without starting work', async () => {
  let flush, payload;
  const storage = {settings: () => ({notifyEmail: 'fictional@example.com'}), secret: () => 'JPF1.fixture.test', saveSettings() {}};
  const message = createWaitingMessage(storage, {channels: () => ['email'], log() {}, setTimer: fn => { flush = fn; },
    sendEmail: mail => sendEmail(storage, {...mail, urgent: true}, async (_url, init) => {
      payload = JSON.parse(init.body); return {json: async () => ({ok: true})};
    })});
  message.add({id: 'fictional', title: 'Platform Engineer', company: 'Example Airlines', note: 'Review and submit this form yourself.'});
  await flush();
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
