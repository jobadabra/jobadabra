// Desktop email links open a fixed view after the renderer is ready, on cold and warm launches.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {installAppLinks} from '../../../lib/app-links.js';

function world(argv = []) {
  const app = new EventEmitter(), ipcMain = new EventEmitter(), sent = [], calls = [];
  const webContents = {}, window = {webContents, isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus')};
  app.isPackaged = true; app.setAsDefaultProtocolClient = scheme => calls.push(scheme);
  app.whenReady = () => Promise.resolve();
  let current = window;
  installAppLinks({app, ipcMain, argv, getWindow: () => current, createWindow: () => { current = window; }, toWindow: (...args) => sent.push(args)});
  const ready = () => ipcMain.emit('appLinksReady', {sender: webContents});
  return {app, ipcMain, sent, calls, ready, window};
}

test('cold launch queues Jobs until the window registers its target listener', async () => {
  const w = world(['app.exe', 'jobadabra://jobs']);
  await Promise.resolve();
  assert.ok(w.calls.includes('jobadabra'));
  assert.deepEqual(w.sent, []);
  w.ready();
  assert.deepEqual(w.sent, [['openTarget', {view: 'jobs'}]]);
});

test('macOS open-url and Windows second-instance links restore the app and select their view', async () => {
  const w = world(); await Promise.resolve(); w.ready();
  let prevented = false;
  w.app.emit('open-url', {preventDefault: () => { prevented = true; }}, 'jobadabra://jobs');
  w.app.emit('second-instance', {}, ['app.exe', 'jobadabra://sessions']);
  assert.equal(prevented, true);
  assert.deepEqual(w.sent, [['openTarget', {view: 'jobs'}], ['openTarget', {view: 'sessions'}]]);
  assert.ok(w.calls.includes('restore') && w.calls.includes('focus'));
});

test('external links cannot execute commands or navigate to arbitrary pages', async () => {
  const w = world(); await Promise.resolve(); w.ready();
  for (const url of ['https://jobs', 'jobadabra://settings', 'jobadabra://jobs/other', 'jobadabra://jobs?run=1', 'jobadabra://user@jobs']) w.app.emit('open-url', {preventDefault() {}}, url);
  assert.deepEqual(w.sent, []);
});
