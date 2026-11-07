// The app's menu bar: Electron's standard menus, plus "Check for Updates…" where Mac users look for it
// (Jobadabra menu, under About); on Windows it sits in Help. Next to it, Update Channel: Stable / Beta / Test builds (lib/update-channel.js,
// the same switch as Settings → Diagnostics); picking one asks first, then checks at once so the build can be installed from there.
// Help → Send Feedback… on both platforms (lib/app-feedback.js). Edit → Find… (⌘F), Find Next (⌘G), Find Previous
// (⇧⌘G): find(what) tells the window ('open' | 'next' | 'previous'; renderer/pages/find.js).
import {t} from '../i18n/native.js';
const channelKey = {stable: 'native.channelStable', beta: 'native.channelBeta', test: 'native.channelTest'};

export function template({name, mac, checkForUpdates, sendFeedback = () => {}, find = () => {}, channel = 'stable', pickChannel = null, zoom = null}) {
  const feedback = {label: t('native.feedback'), click: sendFeedback};
  const channels = pickChannel ? [{label: t('native.updateChannel'), submenu: Object.entries(channelKey).map(([id, key]) =>
    ({label: t(key), type: 'radio', checked: id === channel, click: () => pickChannel(id)}))}] : [];
  const check = [{label: t('native.checkUpdates'), click: checkForUpdates}, ...channels];
  return [
    ...(mac ? [{label: name, submenu: [{role: 'about'}, ...check, {type: 'separator'}, {role: 'services'}, {type: 'separator'},
      {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]}] : []),
    {role: 'fileMenu'},
    {label: t('native.edit'), submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'},
      ...(mac ? [{role: 'pasteAndMatchStyle'}] : []), {role: 'delete'}, {role: 'selectAll'}, {type: 'separator'},
      {label: t('native.find'), accelerator: 'CmdOrCtrl+F', click: () => find('open')},
      {label: t('native.findNext'), accelerator: 'CmdOrCtrl+G', click: () => find('next')},
      {label: t('native.findPrevious'), accelerator: 'Shift+CmdOrCtrl+G', click: () => find('previous')}]},
    zoom ? view(zoom) : {role: 'viewMenu'}, {role: 'windowMenu'},
    {role: 'help', submenu: mac ? [feedback] : [feedback, ...check]},
  ];
}

// View, as Electron's own but with the zoom keys kept in the app's settings (lib/zoom-handlers.js), so the size comes back after a restart.
const view = zoom => ({label: t('native.view'), submenu: [{role: 'reload'}, {role: 'forceReload'}, {role: 'toggleDevTools'}, {type: 'separator'},
  {label: t('native.actualSize'), accelerator: 'CmdOrCtrl+0', click: () => zoom.reset()},
  {label: t('native.zoomIn'), accelerator: 'CmdOrCtrl+Plus', click: () => zoom.zoomIn()},
  {label: t('native.zoomOut'), accelerator: 'CmdOrCtrl+-', click: () => zoom.zoomOut()}, {type: 'separator'}, {role: 'togglefullscreen'}]});

// What "Check for Updates…" answers: {message, detail, buttons, install?}.
export function answer(result, current) {
  if (result?.fromStore) return {type: 'info', message: t('native.storeUpdated'), detail: t('native.storeUpdatedDetail', {version: current}), buttons: [t('native.ok')]};
  if (result?.fromSource) return {type: 'info', message: t('native.fromSource'), detail: t('native.fromSourceDetail'), buttons: [t('native.ok')]};
  if (!result?.ok) return {type: 'warning', message: t('native.updateCheckFailed'), detail: result?.text || t('native.tryLater'), buttons: [t('native.ok')]};
  if (!result.offer) return {type: 'info', message: t('native.upToDate'), buttons: [t('native.ok')], detail: t('native.latestVersion', {version: current})};
  return {type: 'info', message: t('native.newVersion', {version: result.offer.version}), install: true,
    detail: t('native.newVersionDetail', {version: current}), buttons: [t('native.updateNow'), t('native.later')]};
}
