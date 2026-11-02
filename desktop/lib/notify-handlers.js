// Settings → Automation → Notifications over IPC: read and save "Tell me by" and the e-mail address (lib/notify-channel.js). Demo mode never reaches our site.
// Guarded by test/notify-channel.test.js and test/ipc.test.js.
import * as channel from './notify-channel.js';
import {followNotify} from './hosted-email.js';
import {createNotifyMoments} from './notify-moments.js';

export function registerNotifyHandlers({ipcMain, storage, DEMO, log}) {
  const moments = createNotifyMoments(storage);
  ipcMain.handle('notifyState', async () => {
    if (DEMO) return {by: ['email', 'app'], chosen: ['email', 'app'], telegram: channel.telegramReady(storage), email: 'alex@example.com', confirmed: true, marketing: true, cadence: 'daily', reached: true};
    return channel.state(storage);
  });
  // The pop-up for an address that waits for its link (day 3, day 10, the stop): the next one not shown yet, or null. Demo mode shows none.
  ipcMain.handle('notifyMoment', async () => (DEMO ? null : moments.next(await channel.state(storage).catch(() => null))));
  ipcMain.handle('notifyMomentShown', async (_, moment) => { if (!DEMO && ['day3', 'day10', 'stopped'].includes(moment)) moments.shown(moment); });
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
