// LinkedIn jobs: the read's own short-lived hidden browser, and the start-up sweep of LinkedIn sessions left on disk (issue #3711; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md "Design").
// Why (10 Nov 2026, lt's by-hand check): the read ran in the KEPT hidden-browser profile; Chrome wrote the session to its Cookies file during the read, the step expired it only in
// memory, and the app's end (lib/browser-reaper.js SIGKILL) came before Chrome wrote the expiry, so li_at stayed on disk on 4 LinkedIn hosts, valid until 2027.
// Shape: the session only ever enters a profile the step owns (folder READ_FOLDER), which is deleted when the step ends, and again at the next app start if the app was killed mid-read.
// An in-memory browser context would keep it off disk entirely, but the owned extension cannot run there (measured 10 Nov 2026: incognito access stays off; Chrome's protected
// preferences are never forged). Guards: integration/extension/linkedin-session-on-disk.test.mjs, integration/extension/linkedin-read-browser-claims.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {createBackgroundBrowser, holdStartsUntil} from './background-browser.js';

export const READ_FOLDER = 'linkedin-read';
export const KEPT_FOLDER = 'background-browser';
const COOKIE_FILES = [['Default', 'Network', 'Cookies'], ['Default', 'Cookies']];
const LINKEDIN_HOST = "(host_key = 'linkedin.com' OR host_key = '.linkedin.com' OR host_key LIKE '%.linkedin.com')";

/**
 * The LinkedIn read's own hidden browser: its own folder, a worker that never gets the backgroundOwner (it reads pages, never claims a queued application).
 * -> the background browser plus dispose(): close it, wait until it is gone, delete its folder. dispose() -> true when the folder is gone.
 */
export function linkedinReadBrowser(storage, deps = {}) {
  const browser = createBackgroundBrowser(storage, {...deps, name: READ_FOLDER, claims: false});
  const dispose = async () => {
    await browser.quit().catch(() => false);
    return removeFolder(browser.folder);
  };
  return {...browser, dispose};
}

/** Delete a read browser's folder, trying again while a closing helper still writes. -> true when it is gone. Also the job boards' read (lib/headless-boards-beside.js). */
export async function removeFolder(folder) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { fs.rmSync(folder, {recursive: true, force: true}); } catch { /* a helper still writing: tried again */ }
    if (!fs.existsSync(folder)) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return !fs.existsSync(folder);
}

// A profile is in use when its browser still answers on the port it wrote; then nothing in it is touched (Chrome owns its files while it runs).
async function inUse(profile, fetchImpl) {
  let port;
  try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { return false; }
  if (!Number.isInteger(port) || port <= 0) return false;
  return fetchImpl(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(1000)}).then(answer => answer.ok, () => false);
}

/**
 * At app start, before any hidden browser runs: delete the read's folder a killed app left, and remove every LinkedIn cookie row from the KEPT hidden-browser profile
 * (what earlier versions left there). Invariant: only files under the app's own folder (storage.path) are opened; only rows of LinkedIn hosts are deleted, every other
 * site's sign-in stays. `openDb(file)` -> {exec(sql) -> number of rows deleted, close()} (a test passes a spy). -> {readFolder: 'removed'|'none'|'kept', rows, keptRunning?}.
 * Also Easy Apply's batches, when the kept browser closed with the sign-in in it (lib/easy-apply-batch.js).
 */
export async function sweepLinkedinLeftovers(storage, {fetchImpl = globalThis.fetch, openDb = openSqlite} = {}) {
  const readFolder = storage.path(READ_FOLDER), kept = path.join(storage.path(KEPT_FOLDER), 'profile');
  const out = {readFolder: 'none', rows: 0};
  if (fs.existsSync(readFolder)) out.readFolder = (await inUse(path.join(readFolder, 'profile'), fetchImpl)) ? 'kept' : ((await removeFolder(readFolder)) ? 'removed' : 'kept');
  if (await inUse(kept, fetchImpl)) return {...out, keptRunning: true};   // its browser runs again: its cookies are taken out through it, never from under it
  for (const parts of COOKIE_FILES) {
    const file = path.join(kept, ...parts);
    if (!fs.existsSync(file)) continue;
    const db = openDb(file);
    try { out.rows += db.exec(`DELETE FROM cookies WHERE ${LINKEDIN_HOST}`); } finally { db.close(); }
  }
  return out;
}

/**
 * At app start: sweep the LinkedIn leftovers and hold every hidden-browser start until that sweep is done, as one step so the two cannot come apart
 * (#3717 Gitar review: the sweep ran unawaited and a browser could start during it). `log(area, message, fields)`. -> the sweep's promise (it rejects only if `log` throws; the hold ignores that).
 */
export function sweepBeforeAnyStart(storage, log, options = {}) {
  const swept = sweepLinkedinLeftovers(storage, options).then(
    done => { if (done.rows || done.readFolder === 'removed') log('linkedin-jobs', 'leftover session removed', done); return done; },
    error => { log('linkedin-jobs', 'leftover sweep failed', {error: error.message}); return null; });
  holdStartsUntil(swept);
  return swept;
}

function openSqlite(file) {
  // node:sqlite is loaded only here, at the sweep, so nothing else in the app pays for it.
  const {DatabaseSync} = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(file);
  // Why (#3711 review, 10 Nov 2026): a plain DELETE leaves the row's bytes in the file's free pages; secure_delete overwrites them with zeros.
  db.exec('PRAGMA secure_delete = ON');
  return {exec: sql => Number(db.prepare(sql).run().changes) || 0, close: () => db.close()};
}
