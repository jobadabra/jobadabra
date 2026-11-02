// "Send feedback…" in the main process: opening the dialog takes the window's screenshot (before the dialog draws over it) and builds the redacted logs text; sending uses exactly
// that held copy, so what "See what's sent" shows is what leaves (the window cannot hand in anything else). Pure parts: lib/feedback-bundle.js; the HTTP call: lib/app-feedback.js.
import os from 'node:os';
import path from 'node:path';
import * as appFeedback from './app-feedback.js';
import * as pipeline from './pipeline.js';
import * as server from './server.js';
import * as claudeCode from './claude-code.js';
import {buildLogs, shotDataUrl, pageText, profileText, PROFILE_CHARS} from './feedback-bundle.js';
import {aboutYou} from './about-you.js';
import {emailOf} from './notify-channel.js';
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

/** What every feedback carries, shown in "See what's sent": app version, the platform line (OS, version, architecture), the install id and the e-mail the person set for notifications (the dialog puts it in
 *  Contact, where they can clear it). Why (2 Nov 2026, owner: "send the app version, the OS platform, the installation id (the email if user have set it)"). */
export function identity({app, storage}) {
  return {version: app.getVersion(), platform: appFeedback.platformLine(), install: appFeedback.installId(storage), email: emailOf(storage)};
}

/** Registers the dialog's IPC handlers: `feedbackPrepare(screen, pageData)` (picture, logs and this screen's data, held), `feedbackProfile()` (the Profile snapshot, read only when the person turns
 *  it on, held) and `sendFeedback(text, contact, {screenshot, logs, page, profile})` (sends the held copy of the parts left on; demo mode sends nothing; a window that cannot be captured still
 *  sends the note). What leaves is always the held, redacted copy: the window cannot hand in other data at send time. */
export function registerFeedbackHandlers({DEMO, app, ipcMain, storage, track, getWindow, getPlan, profileOf = store => aboutYou(store, 'portrait', {budget: PROFILE_CHARS})}) {
  let held = null;   // {shot, logs, page: {text, bytes, cut} | null, profile: {text, bytes, parts, cut} | null, screen}
  // The dialog is about to open: take the picture first. -> {shot, logs, page, identity}
  ipcMain.handle('feedbackPrepare', async (_, screen = '', pageData = null) => {
    const win = getWindow?.();
    let shot = null;
    try { if (win && !win.isDestroyed()) shot = shotDataUrl(await win.webContents.capturePage()); } catch { /* no picture: the note still goes */ }
    const folder = logFile() ? path.dirname(logFile()) : path.join(app.getPath('userData'), 'logs');
    const runs = pipeline.runs(storage);
    const logs = buildLogs({folder, runs, state: supportState({app, storage, getPlan, screen: String(screen).slice(0, 60)})});
    let page = null;
    try { if (pageData && typeof pageData === 'object') page = pageText(pageData, {runs}); } catch { /* a page that cannot be written sends nothing */ }
    held = {shot, logs, page, profile: null, screen: String(screen).slice(0, 60)};
    return {shot, logs, page, identity: identity({app, storage})};
  });
  // The person turned "Include a snapshot of my whole Profile" on: read it now (a Notion store takes a few seconds). -> {profile: {text, bytes, parts, cut} | null}
  ipcMain.handle('feedbackProfile', async () => {
    const mine = held;   // Why (Gitar on #3021): a Send or a new open during the read replaces `held`; this read lands on the dialog it was asked by
    if (!mine) return {profile: null};
    try { mine.profile = profileText(await profileOf(storage)); } catch { mine.profile = null; }
    return {profile: mine.profile};
  });
  ipcMain.handle('sendFeedback', (_, text, contact, include = {}) => {
    if (DEMO) return {ok: true};
    const keep = held || {};
    const parts = {screenshot: !!(include.screenshot && keep.shot), logs: !!(include.logs && keep.logs), page: !!(include.page && keep.page), profile: !!(include.profile && keep.profile)};
    return appFeedback.send({text, contact, screen: keep.screen, screenshot: parts.screenshot ? keep.shot.dataUrl : '', logs: parts.logs ? keep.logs.text : '', page: parts.page ? keep.page.text : '',
      profile: parts.profile ? keep.profile.text : ''}, {storage, version: app.getVersion()}).then(result => { if (result?.ok) { held = null; track('feedback_sent', parts); } return result; });
  });
}
