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

async function main() {
  const folder = path.join(os.tmpdir(), FOLDER);
  const refusal = practiceRefusal(folder);
  if (refusal) throw new Error(`practice refuses to start: ${refusal}`);
  fs.rmSync(folder, {recursive: true, force: true});   // only the folder the gate just approved
  fs.mkdirSync(folder, {recursive: true});
  // The harness reads these when it loads: a visible window, no trace, its files inside the practice folder.
  Object.assign(process.env, {E2E_TRACE: '0', E2E_HIDDEN: '0', E2E_ARTIFACTS: path.join(folder, 'artifacts')});
  const [{launch, initialSettings}, {chromium}, {storeSettings}, {applicantDraft}, {seedLivePosting}] = await Promise.all([
    import('../e2e/lib/app.mjs'), import('../e2e/lib/visit-page.mjs'), import('../e2e/lib/store.mjs'), import('../e2e/lib/applicant-seed.mjs'), import('../e2e/lib/seed-data.mjs'),
  ]);
  const jobs = practiceJobs();
  const ledger = path.join(folder, 'practice-caught.jsonl');
  const server = await startPractice({cases: loadCases(jobs.map(job => job.name)), ledgerFile: ledger});
  const browserArguments = [`--host-resolver-rules=${server.hostRules()}`, '--ignore-certificate-errors', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
  let app;
  const stop = async code => { try { await app?.close(); } catch { /* already gone */ } await server.close(); process.exit(code); };
  process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
  // The proof the host rule took effect: a real public name must not load, and a practice page must.
  const probe = await chromium.launch({headless: true, args: browserArguments});
  try {
    const page = await probe.newPage();
    const real = await page.goto('https://example.org/', {timeout: 8000}).then(() => 'loaded', () => 'refused');
    if (real !== 'refused') throw new Error('practice refuses to start: a real public name loaded in the practice browser');
    await page.goto(jobs[0].url, {timeout: 8000});
  } finally { await probe.close(); }
  say('host rule proven: a real name does not load, a practice page does');
  fs.writeFileSync(path.join(folder, 'settings.json'), JSON.stringify(initialSettings(storeSettings('sqlite'))));
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'e2e', 'fixtures', 'cv.pdf'), path.join(folder, 'cv.pdf'));
  const opened = await launch({profile: folder, env: {JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify(browserArguments)}});
  app = opened;
  const {page} = opened;
  const ai = await page.evaluate(async strategy => {   // the way the wizard leaves a set-up install; the person's own signed-in Claude Code answers, nothing is paid for per call
    const saved = await window.pilot.saveStrategy(strategy);
    if (!saved?.ok) throw new Error(`the strategy was not saved: ${saved?.error || 'unknown'}`);
    const status = await window.pilot.verifyClaudeCode().catch(() => null);
    if (status?.authenticated) await window.pilot.setAiEngine('cli');
    await window.pilot.saveSettings({setupDone: true, wizardStep: 'draft', setupFurthest: 'draft', cvName: 'cv.pdf'});
    return !!status?.authenticated;
  }, applicantDraft());
  const store = {profile: folder, store: 'sqlite'};
  const ctx = {data: (entity, method, kwargs) => import('../e2e/lib/store-call.mjs').then(({storeCall}) => storeCall(store, entity, method, kwargs))};
  for (const job of jobs) await seedLivePosting(ctx, {url: job.url, title: job.title, company: job.company});
  await page.reload();
  say(`${jobs.length} practice jobs are in the Jobs list; nothing leaves this Mac (the hidden browser reaches only ${server.hosts.length} practice hosts)`);
  say(ai ? 'AI: your signed-in Claude Code answers' : 'AI: Claude Code is not signed in here; choose an AI in Settings before applying');
  say('Settings → Apply → Full automation (you confirm it), then press Apply on a practice job. Every Submit is printed below. Ctrl-C ends it.');
  say(`ledger: ${ledger}`);
  let shown = 0;
  setInterval(() => { const all = server.caught(); for (const entry of all.slice(shown)) say(`CAUGHT ${entry.host}${entry.path}: ${entry.fields.map(([name, value]) => `${name}=${value}`).join(', ')}`); shown = all.length; }, 1000).unref();
  page.on('close', () => stop(0));
}
main().catch(error => { console.error(error.message); process.exit(1); });
