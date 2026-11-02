// "Send feedback…" in the main process: opening the dialog takes the window's screenshot (before the dialog draws over it) and builds the redacted logs text; sending uses exactly
// that held copy, so what "See what's sent" shows is what leaves (the window cannot hand in anything else). Pure parts: lib/feedback-bundle.js; the HTTP call: lib/app-feedback.js.
import os from 'node:os';
import path from 'node:path';
import * as appFeedback from './app-feedback.js';
import * as pipeline from './pipeline.js';
import * as server from './server.js';
import * as claudeCode from './claude-code.js';
import {buildLogs, shotDataUrl} from './feedback-bundle.js';
import {logFile} from './log.js';
import {onNotion} from './notion-gate.js';
import {reportedEngine} from './ai/names.js';

/** The state that matters for support: no keys, no names, no job or CV text. */
export function supportState({app, storage, getPlan, screen = ''}) {
  const settings = storage.settings();
  return {version: app.getVersion(), os: `${process.platform} ${os.release()} ${process.arch}`, locale: app.getLocale?.() || '-', screen: screen || '-',
    aiEngine: reportedEngine(storage, getPlan?.().state?.().plan), aiReady: !!claudeCode.aiReady(settings, !!storage.secret('ANTHROPIC_API_KEY'), !!storage.secret('OPENAI_API_KEY')),
    store: onNotion(storage) ? 'notion' : 'this Mac', extensionPaired: !!server.extensionSeen(), theme: settings.theme || 'dark'};
}

/** Registers the two IPC handlers of the dialog: `feedbackPrepare(screen)` (picture + logs, held) and `sendFeedback(text, contact, {screenshot, logs})` (sends the held copy of the parts left on;
 *  demo mode sends nothing; a window that cannot be captured still sends the note). Data comes from the window, lib/log.js's folder, pipeline runs.json and the settings. */
export function registerFeedbackHandlers({DEMO, app, ipcMain, storage, track, getWindow, getPlan}) {
  let held = null;   // {shot: {dataUrl, bytes, width, height} | null, logs: {text, bytes, parts}}
  // The dialog is about to open: take the picture first. -> {shot: {dataUrl, width, height, bytes} | null, logs: {text, bytes, parts}}
  ipcMain.handle('feedbackPrepare', async (_, screen = '') => {
    const win = getWindow?.();
    let shot = null;
    try { if (win && !win.isDestroyed()) shot = shotDataUrl(await win.webContents.capturePage()); } catch { /* no picture: the note still goes */ }
    const folder = logFile() ? path.dirname(logFile()) : path.join(app.getPath('userData'), 'logs');
    const logs = buildLogs({folder, runs: pipeline.runs(storage), state: supportState({app, storage, getPlan, screen: String(screen).slice(0, 60)})});
    held = {shot, logs, screen: String(screen).slice(0, 60)};
    return {shot, logs};
  });
  ipcMain.handle('sendFeedback', (_, text, contact, include = {}) => {
    if (DEMO) return {ok: true};
    const keep = held || {};
    return appFeedback.send({text, contact, screen: keep.screen, screenshot: include.screenshot && keep.shot ? keep.shot.dataUrl : '', logs: include.logs && keep.logs ? keep.logs.text : ''},
      {storage, version: app.getVersion()}).then(result => { if (result?.ok) { held = null; track('feedback_sent', {screenshot: !!(include.screenshot && keep.shot), logs: !!(include.logs && keep.logs)}); } return result; });
  });
}
