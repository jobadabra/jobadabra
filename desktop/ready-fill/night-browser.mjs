// One night's browser, the same for every task of the cloud runner (spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): a fresh profile, the night's copy of the extension pointed at the stand-in app,
// and the extension's storage set before any page opens. Moved out of night.mjs's fill (8 Nov 2026, cloud runner 1/4) so the read task starts the same browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {copyForNight} from './extension-copy.mjs';
import {setExtensionStorage} from './extension-storage.mjs';

/**
 * Starts the browser. `standIn` is createStandIn()'s; `owned` makes the copy the app-owned kind (no first-install windows, the background poll answered: lib/background-browser.js does the same on the Mac);
 * `storage` adds to the extension's settings (the read task's `backgroundOwner`). -> {context, worker, profile}. A start that fails closes what it opened and throws; the stand-in stays the caller's.
 */
export async function openNightBrowser({chromium, standIn, extensionDir, extraArgs = [], launchOptions = {}, owned = false, storage = {}}) {
  let profile = '', context = null;
  try {
    const copy = copyForNight(standIn.port, extensionDir, '', {owned});
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-night-'));
    context = await chromium.launchPersistentContext(profile, {headless: false, locale: 'en-US', ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'], timeout: 90000, ...launchOptions,
      args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${copy}`, `--load-extension=${copy}`, '--no-first-run', '--no-default-browser-check', ...extraArgs]});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    await setExtensionStorage(worker, {workerUrl: `http://127.0.0.1:${standIn.port}`, token: 'night', ...storage});
    return {context, worker, profile};
  } catch (error) {
    await context?.close().catch(() => {});
    if (profile) fs.rmSync(profile, {recursive: true, force: true});
    throw error;
  }
}
