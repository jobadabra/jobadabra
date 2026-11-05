// The hosted Always on IPC (private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §4): turn it on or off, read its state, download my data, push the profile again after a change.
// main.js passes in the services they share. Guard: test/unit/main/hosted-search.test.js and test/guards/rules/ipc.test.js.
import * as hosted from './hosted-search.js';
import * as pipeline from './pipeline.js';
import {emailOf} from './notify-channel.js';
import {consented} from './email-consent.js';
import {turnOnShared} from './hosted-email.js';
import {createMoments} from './always-on-moments.js';
import {isTwin} from './twin.js';

/**
 * Registers the hosted Always on IPC. Takes main's shared services (`powerMonitor` only for the wake check of the dialog moments); returns nothing. At start it notes a missed check and
 * starts the inbox pull; a handler that fails answers {ok: false, error}. Data: settings.hostedSearch and the site's /api/hosted routes (lib/hosted-search.js).
 */
export function registerHostedHandlers({DEMO, dialog, getWindow, ipcMain, powerMonitor, storage, toWindow}) {
  const engine = args => pipeline.run(storage, args);
  // The dialog moments (lib/always-on-moments.js): noted when the app starts and when the Mac wakes, before the catch-up search (30 s / 60 s later) makes the missed time look fine.
  const moments = createMoments(storage, {available: () => hosted.canRun(storage), busy: () => !!pipeline.running() || pipeline.queued().length > 0});
  if (!DEMO && !isTwin()) {   // a twin runs no schedule (lib/twin.js), so its due time is always in the past
    moments.note();
    powerMonitor?.on('resume', () => { moments.note(); if (moments.next()) toWindow('hostedMoment'); });
  }
  ipcMain.handle('hostedMoment', async () => (DEMO ? null : moments.next()));
  ipcMain.handle('hostedMomentShown', async (_, name) => { if (!DEMO && name === 'missed') moments.shown(name); return {ok: true}; });
  ipcMain.handle('hostedState', async () => {
    const [open, schedule] = await Promise.all([DEMO ? true : hosted.isOpen(storage), !DEMO && hosted.state(storage).on ? hosted.schedule(storage) : null]);   // together: one slow answer does not wait for the other
    return {...hosted.state(storage), canRun: !DEMO && hosted.canRun(storage), shared: DEMO ? 'alex@example.com' : consented(storage) ? emailOf(storage) : '', available: !DEMO, open, schedule};
  });
  ipcMain.handle('hostedOn', async (_, given) => {
    if (DEMO) return {ok: true};
    const done = await turnOnShared(storage, given || {});   // the Notifications address (#1711); one typed in the setup step becomes it
    if (done.ok) hosted.pullInbox(storage, engine).then(pulled => { if (pulled.added) toWindow('hostedArrived', pulled); }).catch(() => {});
    return done;
  });
  ipcMain.handle('hostedOff', async () => (DEMO ? {ok: true} : hosted.turnOff(storage)));
  ipcMain.handle('hostedDelete', async () => (DEMO ? {ok: true} : hosted.deleteData(storage)));   // at any time, also while off (owner, 27 Oct 2026)
  ipcMain.handle('hostedPush', async () => (DEMO || !hosted.state(storage).on ? {ok: true} : hosted.pushConfig(storage)));
  // The Test row on our servers' card (renderer/pages/always-on-test.js): one real run, then its steps. The demo ticks through the same steps without touching the site.
  ipcMain.handle('hostedTestStart', async () => (DEMO ? {ok: true, run: 'demo', since: Date.now()} : hosted.testStart(storage).then(done => ({...done, since: Date.now()}))));
  ipcMain.handle('hostedTestRead', async (_, runId = '', since = 0) => {
    if (!DEMO) return hosted.testRead(storage, runId).catch(error => ({found: false, verdict: 'running', steps: [], url: '', error: error.message}));
    const ticks = Math.floor((Date.now() - since) / 1500);   // five steps, one every 1.5 s, then the first search runs on its own and ends 20 s later
    const titles = ['Always on is on for you', 'Your profile is held on our servers', 'Our server started and read it', 'The AI answers', 'A test e-mail was sent to you'];
    const steps = titles.map((title, index) => ({id: String(index), title, line: '', settings: index === 4, state: ticks > index + 1 ? 'ok' : ticks === index + 1 ? 'running' : 'waiting'}));
    return {found: true, verdict: steps.every(step => step.state === 'ok') ? 'passed' : 'running', steps, url: '', runId: 'demo', search: {state: ticks > 18 ? 'ok' : 'running', found: 3, note: ''}};
  });
  ipcMain.handle('hostedExport', async () => {
    if (DEMO) return {ok: true};
    const win = getWindow();
    const {canceled, filePath} = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {defaultPath: 'jobadabra-hosted-data.json', filters: [{name: 'JSON', extensions: ['json']}]});
    return canceled || !filePath ? {ok: false, cancelled: true} : hosted.exportTo(storage, filePath);
  });
  if (!DEMO && hosted.state(storage).on) hosted.pushConfig(storage).catch(() => {});   // the profile and search settings as they are now (they may have changed since)
  if (!DEMO) hosted.keepFresh(storage, engine, pulled => toWindow('hostedArrived', pulled));
}
