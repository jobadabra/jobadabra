// "Send feedback…" in the main process: opening the dialog takes the window's screenshot (before the dialog draws over it) and builds the redacted logs text; sending uses exactly
// that held copy, so what "See what's sent" shows is what leaves (the window cannot hand in anything else). Pure parts: lib/feedback-bundle.js; the HTTP call: lib/app-feedback.js.
import os from 'node:os';
import path from 'node:path';
import * as appFeedback from './app-feedback.js';
import * as pipeline from './pipeline.js';
import * as server from './server.js';
import * as terminals from './terminals.js';
import * as claudeCode from './claude-code.js';
import {buildLogs, shotDataUrl, pageText, profileText, PROFILE_CHARS} from './feedback-bundle.js';
import {withWarningLines} from './feedback-run-warnings.js';
import {aboutYou} from './about-you.js';
import {emailOf} from './notify-channel.js';
import {logFile} from './log.js';
import {onNotion} from './notion-gate.js';
import {reportedEngine} from './ai/names.js';
import {testerMode} from './tester-mode.js';
import {testerReport, testerLogs, testerState, testerEnv, uploadBundle} from './tester-bundle.js';

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
export function registerFeedbackHandlers({DEMO, app, ipcMain, storage, track, getWindow, getPlan, profileOf = store => aboutYou(store, 'portrait', {budget: PROFILE_CHARS}), tester = () => testerMode(), jobsOf = store => pipeline.jobs(store), upload = uploadBundle}) {
  let held = null;   // {shot, logs, page: {text, bytes, cut} | null, profile: {text, bytes, parts, cut} | null, screen}
  // The dialog is about to open: take the picture first. -> {shot, logs, page, identity}
  ipcMain.handle('feedbackPrepare', async (_, screen = '', pageData = null) => {
    const win = getWindow?.();
    let shot = null;
    try { if (win && !win.isDestroyed()) shot = shotDataUrl(await win.webContents.capturePage()); } catch { /* no picture: the note still goes */ }
    const folder = logFile() ? path.dirname(logFile()) : path.join(app.getPath('userData'), 'logs');
    const runs = withWarningLines(pipeline.runs(storage));
    const logs = buildLogs({folder, runs, state: supportState({app, storage, getPlan, screen: String(screen).slice(0, 60)})});
    let page = null;
    try { if (pageData && typeof pageData === 'object') page = pageText(pageData, {runs}); } catch { /* a page that cannot be written sends nothing */ }
    held = {shot, logs, page, profile: null, screen: String(screen).slice(0, 60), at: new Date()};
    return {shot, logs, page, identity: identity({app, storage}), tester: tester()?.source || null};
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
    if (tester()) return {ok: false, error: 'This is a tester app: file the bug with the tester fields.'};   // Why (code review, 7 Nov 2026): a failed prepare left the person dialog up; an AI report must never reach the real feedback box
    const keep = held || {};
    const parts = {screenshot: !!(include.screenshot && keep.shot), logs: !!(include.logs && keep.logs), page: !!(include.page && keep.page), profile: !!(include.profile && keep.profile)};
    return appFeedback.send({text, contact, screen: keep.screen, screenshot: parts.screenshot ? keep.shot.dataUrl : '', logs: parts.logs ? keep.logs.text : '', page: parts.page ? keep.page.text : '',
      profile: parts.profile ? keep.profile.text : ''}, {storage, version: app.getVersion()}).then(result => { if (result?.ok) { held = null; track('feedback_sent', parts); } return result; });
  });  // Tester mode only (lib/tester-mode.js; no analytics event on purpose: AI reports stay out of real counts): files one bug bundle to the tester route. A person's app has no tester mode, so this refuses and nothing leaves; it never calls appFeedback.send (/api/feedback).
  // `input`: {title, journey, expected, seen, severity, steps}; the window picture and the log window are the held copy's moment (feedbackPrepare), so the evidence is of the bug, not of the press.
  ipcMain.handle('sendTesterBug', async (_, input = {}) => {
    const mode = tester();
    if (DEMO || !mode) return {ok: false, error: 'This app is not in tester mode.'};
    const keep = held;
    if (!keep) return {ok: false, error: 'Open Send feedback first: the bundle is taken when it opens.'};
    const cleaned = testerReport(input, keep.at);
    if (cleaned.error) return {ok: false, error: cleaned.error};
    const folder = logFile() ? path.dirname(logFile()) : path.join(app.getPath('userData'), 'logs');
    const sessions = terminals.list().slice(-3), focused = sessions.at(-1) || null;
    let job = null;
    try { job = focused?.url ? ((await jobsOf(storage))?.jobs || []).find(row => row.url === focused.url) || null : null; } catch { /* no job row: the bundle says null */ }
    const state = supportState({app, storage, getPlan, screen: keep.screen}), seen = server.extensionSeen();
    const files = {'logs.txt': testerLogs({folder, runs: withWarningLines(pipeline.runs(storage)), state, at: keep.at}).text, 'state.json': testerState({sessions, job}),
      'env.json': testerEnv({version: app.getVersion(), platform: appFeedback.platformLine(), extensionVersion: seen?.version, aiEngine: state.aiEngine, store: state.store, mode: focused?.background?.mode, source: mode.source}), 'app.jpg': keep.shot?.dataUrl || ''};
    const result = await upload({source: mode.source, key: mode.key, report: cleaned.report, files});
    if (result?.ok) held = null;   // the next bug is a new open: a second send never reuses this moment's picture and log window
    return result;
  });
}
