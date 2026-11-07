// The system IPC (moved out of main.js, 8 Oct 2026): the microphone and screen permissions, relaunching the app, resetting the profile, backups
// (now, folder, status) and exporting or importing the whole profile. main.js passes in the services they share. Guards: the reset, backup and
// import tests in desktop/test.
import {t} from '../i18n/native.js';
import * as backup from './backup.js';
import * as contactDetails from './contact.js';
import * as pipeline from './pipeline.js';
import * as reset from './reset.js';
import * as viewCache from './view-cache.js';
import * as profileAccounts from './profile-accounts.js';   // job-site accounts per profile: exported when ticked, removed at a reset
import fs from 'node:fs';
import path from 'node:path';
import {SECRET_NAMES} from './storage.js';
import {log as appLog} from './log.js';
import {titlesOf} from './target-roles.js';

export function registerSystemHandlers(ctx) {
  const {DEMO, about, app, backupNow, dataJob, dialog, handleImportant, ipcMain, mediaAccess, getResetDone, restartApp, shell, storage, getWindow} = ctx;
  const moved = profileAccounts.start(storage, {demo: DEMO});   // before any window or run: the profile's id for Credentials and the engine, old accounts moved by e-mail
  if (moved) appLog('data', 'job-site accounts per profile', moved);   // counts only
  let resetTold = false;   // the window is told once about a reset or import that was applied at start
  // macOS privacy: the recorder needs the microphone, and Screen & System Audio Recording for the call's audio.
  // In development (npm start) macOS may list the terminal that started the app instead of Electron.
  ipcMain.handle('mediaAccess', () => (DEMO ? {microphone: 'granted', screen: 'granted', dev: false} : {microphone: mediaAccess('microphone'),
    screen: mediaAccess('screen'), dev: !app.isPackaged}));
  ipcMain.handle('openPrivacy', (_, kind) => shell.openExternal(process.platform === 'win32' ? 'ms-settings:privacy-microphone'
    : `x-apple.systempreferences:com.apple.preference.security?Privacy_${kind === 'screen' ? 'ScreenCapture' : 'Microphone'}`));
  ipcMain.handle('relaunch', () => restartApp('asked by the window (permission or update toast)'));
  // Danger zone: a last native confirmation, then restart; the folder goes at the next start (lib/reset.js).
  // A reset only clears this Mac and never calls Notion (owner, 16 Oct 2026); connecting Notion later is the normal first-time flow.
  handleImportant('resetProfile', 'Resetting this computer', async () => {
    const answer = dialog.showMessageBoxSync(getWindow(), {type: 'warning', buttons: [t('native.cancel'), t('native.resetButton')], defaultId: 0, cancelId: 0,
      message: t('native.resetTitle'), detail: t('native.resetDetail')});   // about Notion
    if (answer !== 1) return {ok: false};
    // The Gmail sign-in lives in the Keychain, outside the data folder: forgotten too, or the fresh setup shows the old account (9 Oct 2026).
    if (!DEMO) {
      try { await pipeline.run(storage, ['src.sources.google', 'disconnect']); appLog('connections', 'Gmail disconnected', {from: 'reset'}); }
      catch (error) { appLog('connections', 'Gmail not disconnected at reset', {error: error.message}); }
    }
    const removed = profileAccounts.onReset(profileAccounts.profileId(storage));   // this profile's job-site accounts go; the export with accounts ticked brings them back
    appLog('data', 'reset: job-site accounts removed', {count: removed});
    reset.request(storage.dir);
    restartApp('reset');
    return {ok: true};
  });
  // Told once per app start: a window reload (⌘R) asks again, and must not re-show "Data imported ✓" for an import done long ago.
  ipcMain.handle('lastReset', () => { const done = resetTold ? null : getResetDone(); resetTold = true; return done; });
  // What lives only on this Mac: the weekly automatic backup (lib/backup.js), or now.
  ipcMain.handle('showFile', (_, file) => { if (typeof file === 'string' && path.isAbsolute(file) && fs.existsSync(file)) shell.showItemInFolder(file); });
  ipcMain.handle('dataCancel', () => dataJob.cancel());
  ipcMain.handle('backupNow', () => backupNow('button'));
  // Clear my job list (src/clear_jobs.py): the counts first; the clear itself after a backup, and only if the backup was made.
  ipcMain.handle('clearJobsPlan', (_, options) => DEMO ? {ok: true, clear: 84, keep: 12, dismissed: 3} : pipeline.clearJobs(storage, {...options, dryRun: true}).catch(error => ({ok: false, error: error.message})));
  handleImportant('clearJobs', 'Clearing your job list', async (_, options) => {
    if (DEMO) return {ok: true, cleared: 84, kept: 12};
    const saved = await backupNow('clear job list');   // its own job, shown on the backup strip
    if (!saved.ok) return {ok: false, error: `The backup before clearing failed (${saved.error}); nothing was cleared.`};
    // One job at a time like an export; the clear cannot be stopped half-way (the store is written first), so the strip has no Cancel.
    const result = await dataJob.run('clear', () => pipeline.clearJobs(storage, {...options, dryRun: false})).catch(error => ({ok: false, error: error.message}));
    appLog('data', result?.ok ? 'job list cleared' : 'job list not cleared', {cleared: result?.cleared, kept: result?.kept, error: result?.ok ? undefined : result?.error, by: 'you'});
    if (result?.ok) viewCache.jobsCleared(storage);
    return result;
  });
  ipcMain.handle('showBackups', () => { fs.mkdirSync(backup.folder(), {recursive: true}); return shell.openPath(backup.folder()); });
  ipcMain.handle('backupStatus', () => ({at: storage.settings().lastBackupAt || null, file: storage.settings().lastBackupFile || null,
    folder: backup.folder(), place: backup.place(backup.folder())}));
  // Export: one file with this computer's Jobadabra data (keys only when asked: they're in plain text there).
  // notion: also a read-only copy of the whole Notion workspace (notion.json), to keep or move elsewhere.
  handleImportant('exportProfile', 'Exporting your data', async (_, {keys = false, accounts = false} = {}) => {
    // Whose data and when: the name from the Profile's contact details (3 s at most: never hold the dialog on Notion), the first role searched for.
    const contact = await Promise.race([contactDetails.read(storage).catch(() => ({})), new Promise(done => setTimeout(() => done({}), 3000))]);
    const role = (() => { try { return titlesOf(JSON.parse(storage.readText('config/search.json') || '{}'))[0] || ''; } catch { return ''; } })();
    const name = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    const picked = await dialog.showSaveDialog(getWindow(), {title: t('native.exportData'),
      defaultPath: path.join(app.getPath('documents'), reset.exportName({name, role})), filters: [{name: t('native.exportFilter'), extensions: ['gz']}]});
    if (picked.canceled || !picked.filePath) return {ok: false};
    // Why (3 Nov 2026, desktop AI MCP spec): the desktop AI pairing is bound to this PC's Keychain/DPAPI bridge entry; a restored hash would show "connected" with no bridge.
    const secrets = keys ? Object.fromEntries(SECRET_NAMES.filter(name => !name.startsWith('DESKTOP_AI_')).map(name => [name, storage.secret(name)]).filter(([, value]) => value)) : null;
    // This Mac's data only: Notion data stays in Notion, with Notion's own history, Duplicate, Export and Move (owner, 8 Oct 2026).
    try {
      const siteAccounts = accounts ? profileAccounts.exportable() : null;   // only this profile's, only when ticked
      await dataJob.run('export', options => reset.exportTo(storage.dir, picked.filePath, {keys: secrets, accounts: siteAccounts, version: about.label, ...options}));
      appLog('data', 'exported', {keys: !!secrets, accounts: siteAccounts ? Object.keys(siteAccounts).length : false});
      return {ok: true, file: picked.filePath};
    } catch (error) {
      if (error.code === 'cancelled') { appLog('data', 'export cancelled'); return {ok: false, cancelled: true}; }
      appLog('data', `export failed: ${error.message}`);
      return {ok: false, error: error.message};
    }
  });
  // Import: the file replaces this computer's data (which is kept as a backup), at a restart.
  ipcMain.handle('importProfile', async () => {
    const picked = await dialog.showOpenDialog(getWindow(), {title: t('native.importData'), properties: ['openFile'],
      filters: [{name: t('native.exportFilter'), extensions: ['gz', 'tgz']}]});
    if (picked.canceled || !picked.filePaths[0]) return {ok: false};
    const answer = dialog.showMessageBoxSync(getWindow(), {type: 'warning', buttons: [t('native.cancel'), t('native.importButton')], defaultId: 0, cancelId: 0,
      message: t('native.importTitle'), detail: t('native.importDetail')});
    if (answer !== 1) return {ok: false};
    try { await dataJob.run('import', options => reset.stageImport(storage.dir, picked.filePaths[0], options)); }
    catch (error) { return error.code === 'cancelled' ? {ok: false, cancelled: true} : {ok: false, error: error.message}; }
    restartApp('import');
    return {ok: true};
  });
}
