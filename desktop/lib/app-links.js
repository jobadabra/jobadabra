// Desktop links from emails select fixed pages; pending links wait for the renderer's target listener.
import {standInHost} from './e2e-host.js';

const VIEWS = new Set(['jobs', 'sessions']);
const viewOf = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'jobadabra:' && VIEWS.has(url.hostname) && ['', '/'].includes(url.pathname) && !url.search && !url.hash && !url.username && !url.password && !url.port ? url.hostname : null;
  } catch { return null; }
};

/** Install cold-launch and running-app link delivery. Invariant: links only select Jobs or Applying; they never start work or submit forms. */
export function installAppLinks({app, ipcMain, getWindow, createWindow, toWindow, argv = process.argv}) {
  standInHost({app});   // Protocol setup precedes handlers(): close this host door before whenReady in test runs.
  let pending = argv.map(viewOf).find(Boolean), started = false;
  const ready = new WeakSet();
  const deliver = () => {
    if (!started || !pending) return;
    if (!getWindow() || getWindow().isDestroyed()) createWindow();
    const window = getWindow();
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    if (!ready.has(window.webContents)) return;
    toWindow('openTarget', {view: pending});
    pending = null;
  };
  const accept = url => { const view = viewOf(url); if (view) { pending = view; deliver(); } };
  app.on('open-url', (event, url) => { event.preventDefault(); accept(url); });
  app.on('second-instance', (_event, args) => { for (const arg of args) accept(arg); });
  ipcMain.on('appLinksReady', event => {
    if (event.sender !== getWindow()?.webContents) return;
    ready.add(event.sender); started = true; deliver();
  });
  app.whenReady().then(() => {
    // Development and test runs must never take the installed app's protocol registration.
    if (app.isPackaged) app.setAsDefaultProtocolClient('jobadabra');
  });
}
