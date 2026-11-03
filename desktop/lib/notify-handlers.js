// Settings → Notifications over IPC: read and save "Tell me by" and the e-mail address (lib/notify-channel.js). Demo mode never reaches our site.
// Guarded by test/notify-channel.test.js and test/ipc.test.js.
import * as channel from './notify-channel.js';
import {followNotify} from './hosted-email.js';
import {createNotifyMoments} from './notify-moments.js';
import {waitingMessageFor} from './waiting-message.js';

const MOMENTS = ['day3', 'day10', 'stopped', 'waited', 'lost', 'match', 'reply', 'recruiter'];

export function registerNotifyHandlers({ipcMain, storage, DEMO, log}) {
  const moments = createNotifyMoments(storage);
  ipcMain.handle('notifyState', async () => {
    if (DEMO) return {by: ['email', 'app'], chosen: ['email', 'app'], telegram: channel.telegramReady(storage), email: 'alex@example.com', confirmed: true, marketing: true, cadence: 'daily', reached: true};
    return channel.state(storage);
  });
  // The pop-ups (lib/notify-moments.js): `moment` is the next one the main process knows (an application that waited, an address reminder, Full automation with nobody to tell) or null; `seenAt`/`backAt`
  // (lib/window-seen.js) and `done` are what the window needs to judge the moments it detects itself (a match or Gmail update while the person was away, a recruiter waiting). Demo mode shows none.
  ipcMain.handle('notifyMoment', async () => {
    if (DEMO) return null;
    const state = await channel.state(storage).catch(() => null), settings = storage.settings();
    return {allowed: moments.allowed(state), moment: moments.next(state, Date.now(), {waited: waitingMessageFor(storage).waitedFor()}), seenAt: settings.windowSeenAt || '', backAt: settings.windowBackAt || '', done: moments.done(), state};
  });
  ipcMain.handle('notifyMomentShown', async (_, moment) => { if (!DEMO && MOMENTS.includes(moment)) moments.shown(moment); });
  // The card's Resend: the confirm mail again (jobadabra-web #333). Demo mode never reaches our site.
  ipcMain.handle('notifyResend', async () => {
    if (DEMO) return {ok: true};
    const result = await channel.resend(storage);
    log('notify', result.ok ? 'confirm mail sent again' : 'confirm mail not sent again', {code: result.code || ''});
    return result;
  });
  ipcMain.handle('notifySave', async (_, choice) => {
    if (DEMO) return {ok: true};
    const result = await channel.save(storage, choice || {});
    log('notify', result.ok ? 'saved' : 'not saved', {by: (choice?.by || []).join(','), email: !!choice?.email, error: result.error || ''});
    if (result.ok) {   // Always on, when on, follows a changed address or news choice (#1711: one shared e-mail)
      const moved = await followNotify(storage).catch(error => ({ok: false, error: error.message}));
      if (moved.moved || !moved.ok) log('notify', moved.ok ? 'Always on follows the new address' : 'Always on did not follow the new address', {error: moved.error || ''});
      if (!moved.ok) return {...result, warning: 'Saved, but Always on still sends to your old address. Try again in a moment.'};
    }
    return result;
  });
}
