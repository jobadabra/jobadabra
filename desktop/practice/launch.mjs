/* global window */
// npm run practice (in desktop/): a second app whose Jobs list holds practice jobs, so Full automation can run end to end with no real application (spec 2026-11-07-practice-jobs-design.md).
// Dev only: this file starts the app from the source checkout; it is not in the installer (package.json build.files) and nothing in lib/ imports it.
//   1. refuses unless its folder is the throwaway one in the temp folder (gate.js), then starts that folder empty
//   2. serves the practice jobs' recorded pages and catches every Submit (server.js); the ledger lands in <folder>/practice-caught.jsonl and each catch is printed here
//   3. proves the host rule blocks a real public name (a browser that loads it stops the start) and still opens a practice page
//   4. starts the app as the e2e harness does (JOBADABRA_E2E: its own port, secrets in its folder, no Finder/clipboard/browser doors; lib/e2e-host.js), with the hidden browser mapped to the server
//   5. sets it up with the fictional applicant and the 12 jobs; Full automation is turned on by the person in its Settings, with the real confirmation
// Why (7 Nov 2026, pj 2/4): reusing the harness's app start gives practice the isolation tests already have, so no new door is added to shipped code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FOLDER, practiceRefusal} from './gate.js';
import {practiceJobs} from './jobs.js';
import {loadCases, startPractice} from './server.js';

const say = text => console.log(`practice: ${text}`);
// What a stopped run has to give back: the app, the server (and its certificate folder), the lock, the stand-ins. Set as each is made, so a failure at any step closes what exists.
const held = {app: null, server: null, lock: '', shim: null, stopping: false};
// Why (7 Nov 2026, pj 2/4, code review): a failed start used to exit without closing the app or the server (a lingering Electron, a private key left in the temp folder), a second
// Ctrl-C started a second close, and a second `npm run practice` wiped the first one's live folder. One stop for every way out, entered once, with a deadline.
async function stop(code) {
  if (held.stopping) return;
  held.stopping = true;
  setTimeout(() => process.exit(code), 20000).unref();
  // The files and the server first: the first launch ended with the app's close and left the lock and a certificate folder behind (the process was gone before it got to them),
  // so nothing that matters is left for after the app's own close.
  if (held.lock) fs.rmSync(held.lock, {force: true});
  if (held.shim) fs.rmSync(path.dirname(held.shim.bin), {recursive: true, force: true});
  try { await held.server?.close(); } catch { /* already closed */ }
  try { await held.app?.close(); } catch { /* already gone */ }
  process.exit(code);
}

/** Take the lock that keeps two practice apps off one folder; -> why not, or ''. */
function takeLock(lock) {
  try { const pid = Number(fs.readFileSync(lock, 'utf8')); if (pid && pid !== process.pid) { process.kill(pid, 0); return `another practice app is running (process ${pid}); stop it first`; } } catch { /* no lock, or its process is gone */ }
  fs.writeFileSync(lock, String(process.pid));
  held.lock = lock;
  return '';
}

/**
 * The host-rule proof, with the arguments the app's hidden browser gets: a real public name must fail to RESOLVE (not just fail: a timeout or an offline Mac proves nothing),
 * and a practice page must load with status 200. Each load gets its own page: a refused load leaves a page on Chrome's error page and the next load on it collides
 * (Why, 7 Nov 2026, pj 2/4 first launch: "interrupted by another navigation to chrome-error://"; reproduced with a shared page, loads with two).
 */
async function proveHostRule(chromium, args, practiceUrl) {
  const probe = await chromium.launch({headless: true, args});
  try {
    const real = await (await probe.newPage()).goto('https://example.org/', {timeout: 8000}).then(() => 'loaded', error => (/ERR_NAME_NOT_RESOLVED/.test(error.message) ? 'refused' : `failed another way: ${error.message.split('\n')[0]}`));
    if (real !== 'refused') throw new Error(`practice refuses to start: a real public name was not refused by the host rule (${real})`);
    const response = await (await probe.newPage()).goto(practiceUrl, {timeout: 8000});
    if (response?.status() !== 200) throw new Error(`practice refuses to start: a practice page answered ${response?.status()}`);
  } finally { await probe.close(); }
}

async function main() {
  const folder = path.join(os.tmpdir(), FOLDER);
  const refusal = practiceRefusal(folder);
  if (refusal) throw new Error(`practice refuses to start: ${refusal}`);
  const busy = takeLock(`${folder}.pid`);
  if (busy) throw new Error(`practice refuses to start: ${busy}`);
  fs.rmSync(folder, {recursive: true, force: true});   // only the folder the gate just approved, and no other practice app holds it
  fs.mkdirSync(folder, {recursive: true});
  // The harness reads these when it loads: a visible window, no trace, its files inside the practice folder.
  Object.assign(process.env, {E2E_TRACE: '0', E2E_HIDDEN: '0', E2E_ARTIFACTS: path.join(folder, 'artifacts')});
  const [{launch, initialSettings}, {chromium}, {makeOpenShim}, {storeSettings}, {applicantDraft}, {seedLivePosting}, {storeCall}] = await Promise.all([
    import('../e2e/lib/app.mjs'), import('../e2e/lib/visit-page.mjs'), import('../e2e/lib/extension.mjs'), import('../e2e/lib/store.mjs'), import('../e2e/lib/applicant-seed.mjs'),
    import('../e2e/lib/seed-data.mjs'), import('../e2e/lib/store-call.mjs'),
  ]);
  const jobs = practiceJobs();
  const ledger = path.join(folder, 'practice-caught.jsonl');
  held.server = await startPractice({cases: loadCases(jobs.map(job => job.name)), ledgerFile: ledger});
  const server = held.server;
  const browserArguments = [`--host-resolver-rules=${server.hostRules()}`, '--ignore-certificate-errors', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
  await proveHostRule(chromium, browserArguments, jobs[0].url);
  say('host rule proven: a real name does not resolve, a practice page loads');
  // Why (7 Nov 2026, pj 2/4, code review): the app opens pages in the person's own Chrome (through the `open` command, in the non-background Apply modes) and asks it about its tabs
  // (osascript). Only the harness's stand-ins keep it from doing either: `open` writes the URL to a folder instead, and `osascript` fails. Full automation uses the hidden browser.
  held.shim = makeOpenShim();
  fs.writeFileSync(path.join(held.shim.bin, 'osascript'), '#!/bin/sh\necho "practice: the app may not drive the person\'s Chrome" >&2\nexit 1\n', {mode: 0o755});
  fs.writeFileSync(path.join(folder, 'settings.json'), JSON.stringify(initialSettings(storeSettings('sqlite'))));
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'e2e', 'fixtures', 'cv.pdf'), path.join(folder, 'cv.pdf'));
  // Why (10 Nov 2026, hw): the folder starts empty, so the hidden browser was missing and every Apply offered a 200 MB download into a folder the next start wipes.
  // This is the e2e harness's link to the installed test Chromium, made into this folder only.
  const {linkRuntime} = await import('../e2e/lib/background-proof.mjs');
  const unlinked = linkRuntime(folder);
  say(unlinked ? `hidden browser: ${unlinked}; Apply will offer its download` : 'hidden browser: the installed test Chromium, no download');
  held.app = await launch({profile: folder, env: {
    JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify(browserArguments),
    USER: process.env.USER,   // Claude Code finds its Keychain sign-in under it; without it practice had no AI (hw, 10 Nov 2026; e2e/lib/app-env.mjs EXPLICIT_ONLY)
    JOBADABRA_PRACTICE_LEDGER: ledger,   // the window's banner and each job's Practice view read it (lib/practice-mode.js)
    PATH: `${held.shim.bin}${path.delimiter}${process.env.PATH}`, JOBADABRA_E2E_OPEN_DIR: held.shim.spool,
    ...(process.platform === 'win32' ? {JOBADABRA_E2E_OPENER: held.shim.script} : {}),
  }});
  const {page} = held.app;
  page.on('close', () => stop(0));
  const ai = await page.evaluate(async strategy => {   // the way the wizard leaves a set-up install; the person's own signed-in Claude Code answers, nothing is paid for per call
    const saved = await window.pilot.saveStrategy(strategy);
    if (!saved?.ok) throw new Error(`the strategy was not saved: ${saved?.error || 'unknown'}`);
    const status = await window.pilot.verifyClaudeCode().catch(() => null);
    if (status?.authenticated) await window.pilot.setAiEngine('cli');
    await window.pilot.saveSettings({setupDone: true, wizardStep: 'draft', setupFurthest: 'draft', cvName: 'cv.pdf'});
    return !!status?.authenticated;
  }, applicantDraft());
  const ctx = {data: (entity, method, kwargs) => storeCall({profile: folder, store: 'sqlite'}, entity, method, kwargs)};
  for (const job of jobs) await seedLivePosting(ctx, {url: job.url, title: job.title, company: job.company});
  await page.reload();
  const stored = await storeCall({profile: folder, store: 'sqlite'}, 'applications', 'list', {});
  await page.waitForSelector('.view:not([hidden])', {timeout: 30000});
  await held.app.shot('practice-start');   // the window as painted, kept in <folder>/artifacts: the evidence of what the person would see
  say(`${Array.isArray(stored) ? stored.length : '?'} jobs read back from the store; ${jobs.length} practice jobs are in the Jobs list; the hidden browser reaches only ${server.hosts.length} practice hosts`);
  say(ai ? 'AI: your signed-in Claude Code answers' : 'AI: Claude Code is not signed in here; choose an AI in Settings before applying');
  say('The practice jobs are under Jobs → filter "Saved" (the default New matches list is for jobs a search found). Settings → Apply → Full automation (you confirm it), then press Apply on a practice job. Other Apply modes open nothing (the person\'s Chrome is off limits here). Every Submit is printed below. Ctrl-C ends it.');
  say(`ledger: ${ledger}`);
  let shown = 0;
  setInterval(() => { const all = server.caught(); for (const entry of all.slice(shown)) say(`CAUGHT ${entry.host}${entry.path}: ${entry.fields.map(([name, value]) => `${name}=${value}`).join(', ')}`); shown = all.length; }, 1000).unref();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
main().catch(error => { console.error(error.message); return stop(1); });
