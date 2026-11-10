// Testable Electron startup, activation, quit decisions and terminal shutdown; services are injected.
import {activityText} from '../i18n/activity-notices.js';
import * as quitDialog from './quit-dialog.js';
import {chooseCloud, offerFor} from './cloud-quit.js';
import {cloudAutoOf} from './cloud-auto.js';
import {NO_PLACE} from '../renderer/targets.js';

/**
 * One copy per data folder. The later copy quits at once (onDuplicate: it runs before start(), so its line cannot reach app.log);
 * the first copy brings its window forward and logs it (onSecondCopy), so a vanished second launch leaves a trace in app.log.
 * Windows foreground rights for window.focus() are unproven here (a taskbar flash is possible).
 */
export function claimInstance({app, onDuplicate = () => {}, onSecondCopy = () => {}, getWindow, createWindow}) {
  const firstCopy = app.requestSingleInstanceLock();
  if (!firstCopy) app.whenReady().then(() => { onDuplicate(); app.quit(); });
  app.on('second-instance', () => {
    if (!app.isReady()) return;
    onSecondCopy();
    if (!getWindow()) createWindow();
    const window = getWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return firstCopy;
}

export function startWhenReady({app, firstCopy, start, getWindows, createWindow}) {
  if (!firstCopy) return Promise.resolve();
  return app.whenReady().then(() => {
    // false means the app moved to Applications and is opening the moved copy instead.
    if (start() === false) return;
    app.on('activate', () => { if (!getWindows().length) createWindow(); });
  });
}

// Why (2026-10-28, owner): the hidden browser closes with the app, so an application it is still filling or about to submit counts as work a quit would cut off; one waiting for the person does not.
const WORKING = new Set(['queued', 'preflight', 'filling', 'waiting_to_submit', 'submitting']);
const fillingHidden = session => WORKING.has(session.background?.state);

export function installQuitHandling({app, platform, state, pipeline, terminals, critical = {labels: () => [], whenDone: () => Promise.resolve()}, stopDataJob = () => Promise.resolve(), dataRunning = () => false, shouldAskOnQuit,
  askWhyLeaving, showDialog, icon, getWindows, toWindow, notify, later = setTimeout, log = () => {}, onCancel = () => {}, cloudQuit = {offerFor, chooseCloud}}) {   // cloudQuit: a test's own (lib/cloud-quit.js)
  let quitting = false;
  app.on('window-all-closed', () => { if (platform !== 'darwin') app.quit(); });
  // Any quit, asked or not (update install, last window): an export, import or backup still running is stopped and its tar awaited first, then the quit goes on.
  let dataStopped = false;
  const stopDataThenQuit = () => {
    dataStopped = true;   // once: a job that will not stop does not hold the quit again
    Promise.resolve().then(stopDataJob).catch(error => log('window', `stopping the data job failed: ${error.message}`)).then(() => app.quit());
  };
  // Why (31 Oct 2026, owner): every way out ends the engine's children and waits for their exit, so none outlives the app holding a hung AI call or the data folder. An untracked read
  // (src.focus, a store call) is no task the quit guard asks about, so this is the one place that stops it; it comes back here once they are gone.
  let enginesStopped = false;
  const stopEnginesThenQuit = () => {
    enginesStopped = true;   // once: a child that will not exit does not hold the quit again
    Promise.resolve().then(() => pipeline.stopRunning()).catch(error => log('window', `stopping the engine runs failed: ${error.message}`)).then(() => app.quit());
  };
  app.on('will-quit', event => {
    if (!dataStopped && dataRunning()) { event.preventDefault(); stopDataThenQuit(); return; }   // the quit comes back here once the job is gone
    if (!enginesStopped && pipeline.hasChildren()) { event.preventDefault(); stopEnginesThenQuit(); return; }
    terminals.shutdown();
  });
  // The quit dialog's Always on button (lib/cloud-quit.js): quit, or stay open on Always on's own card when nothing could be turned on.
  const thirdButton = (storage, cloud, window) => cloudQuit.chooseCloud(storage, cloud).then(next => {
    if (next === 'quit') { quitting = true; app.quit(); return; }
    onCancel(); window?.show(); toWindow('openTarget', {card: 'always-on'});
  });
  // Only sessions are working: keep them, stop them and quit, or (a Pro install with Full automation applications) the Always on button.
  const sessionsOnlyQuit = ({storage, window, sessions, label, show}) => {
    const cloud = storage ? cloudQuit.offerFor(storage, sessions) : null;   // what Always on does for them (lib/cloud-quit.js, cs 4/4)
    const choice = show(quitDialog.sessionsOnly(sessions, label, cloud), 0);
    log('window', 'quit decision', {choice: ['keep sessions', 'stop sessions', 'always on'][choice] || 'stop sessions', cloud: cloud || '', sessions: sessions.length});
    if (choice === 0) { onCancel(); window?.show(); toWindow('session', 'open', {id: sessions[0].id}); return; }
    if (choice === 2 && cloud) return thirdButton(storage, cloud, window);
    if (cloud === 'on') cloudAutoOf(storage)?.declineQuit();   // "Stop and quit" there stops them as before: this quit hands nothing over
    quitting = true;
    app.quit();
  };
  const beforeQuit = event => {
    const {storage, window, telemetry, demo, smoke} = state();
    if (quitting || demo || smoke) return;
    if (storage && window && !window.isDestroyed() && shouldAskOnQuit(storage.settings(), !!telemetry?.enabled())) {
      event.preventDefault();
      storage.saveSettings({leaveAsked: true});
      window.show();
      askWhyLeaving();
      later(() => app.quit(), 5 * 60 * 1000);
      log('window', 'quit deferred for setup feedback');
      return;
    }
    const busy = pipeline.running(), queue = pipeline.queued();
    const sessions = [...terminals.running().filter(session => session.status === 'running'), ...(terminals.list?.() || []).filter(fillingHidden)];
    const important = critical.labels();   // an export, a Notion workspace being built…: never cut off without asking
    if (!busy && !queue.length && !sessions.length && !important.length) return;
    event.preventDefault();
    const label = session => session.company || terminals.label(session);
    const show = (dialog, cancelId) => showDialog(getWindows()[0], {
      type: 'none', icon: icon(), ...dialog, defaultId: 0, cancelId,
    });
    if (!busy && !queue.length && !important.length) return sessionsOnlyQuit({storage, window, sessions, label, show});
    const dialog = quitDialog.working({busy, queue, sessions, important, label, taskName: pipeline.taskName});
    const choice = show(dialog, 2);
    log('window', 'quit decision', {choice: ['when idle', 'now', 'cancel'][choice], queued: queue.length, sessions: sessions.length, important: important.join(', ')});
    if (choice === 2) { onCancel(); return; }
    quitting = true;
    if (choice === 1) {
      cloudAutoOf(storage)?.declineQuit();   // "Quit now" says it stops them (code review of cs 4/4): this quit hands nothing over
      pipeline.freezeQueue(storage);
      pipeline.stopRunning();
      if (dataRunning()) stopDataThenQuit();   // the data job's tar is gone before the app goes
      else app.quit();
      return;
    }
    notify(activityText('quitTitle'), dialog.detail, NO_PLACE.app, 'info');
    Promise.all([pipeline.whenIdle(), critical.whenDone()]).then(() => app.quit());
  };
  // Why (cs 4/4, 10 Nov 2026): the Ready send and the cloud hand-over (lib/ready-auto.js startAutoSend) also listen to before-quit and skip a quit that is already held; this one goes FIRST, so
  // "Keep working" never finds its applications already handed to the cloud, and "Stop and quit" can say so before anything is sent.
  (app.prependListener || app.on).call(app, 'before-quit', beforeQuit);
  return beforeQuit;
}
