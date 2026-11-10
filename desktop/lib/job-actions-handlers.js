// The job actions' IPC (moved out of main.js, 8 Oct 2026): running a Telegram-style command from the app, adding a job or an applied one by hand, standard
// answers, re-scoring older scores, the reasons for dismissing a job and the anonymous intel snapshot. main.js passes in the services they
// share. Guards: the command, add-job and rescore tests in desktop/test.
import * as applicationOutcomes from './outcomes.js';
import * as controlEvents from './control-events.js';
import * as pipeline from './pipeline.js';
import {keepCloudRead, readinessOf} from './apply-readiness-registry.js';
import {createCloudRead} from './cloud-read.js';
import {state as hostedSearch} from './hosted-search.js';
import {classify, resultLine} from './top-matches-line.js';
import {keysOf} from './ai/index.js';
import {ownKeyFor} from './ready-batch.js';
import {pickTop} from './ready-top.js';
import * as questions from './questions.js';
import * as questionLists from './question-lists.js';
import * as telegram from './telegram.js';
import {log as appLog} from './log.js';

// Apply readiness on the top matches (spec 2026-11-07-apply-readiness-design.md, owner's answer 2): the best-scored open jobs without a kit, as many as the engine's kits mode drafted (KITS_DEFAULT).
const TOP_MATCHES = 3;
/** Each top match through the one step, one after the other, each saying its own kit's notices. */
async function readyTop(readiness, jobs) {
  for (const job of jobs) await readiness.applyReadiness({url: job.url, code: job.code, title: `${job.title} · ${job.company}`, kit: false, posted_at: job.posted_at || ''}, {notices: 'all'});
}

export function registerJobActionsHandlers(ctx) {
  const {DEMO, allowanceBlock, cloud, dispatchNote, intelLib, ipcMain, log, needsNotion, getRecipeReporter, storage, jobsList = pipeline.jobs, cloudSite} = ctx;   // jobsList: a test hands in its own list
  // Prepare top matches (Actions), now Apply readiness on the top matches: on this Mac each one goes through the one step (its kit, then its form check). Not a Telegram command.
  // Always on (on our servers or on the person's own GitHub, owner 9 Nov 2026: "it doesn't care"): the forms are read by the cloud browser (lib/cloud-read.js, cloud browser runner 3/4) and go through the same step; the result line is the run's own (lib/top-matches-line.js).
  const prepareTopMatches = async () => {
    const gate = needsNotion('kits');
    if (gate) return gate;
    const blocked = await allowanceBlock();
    if (blocked) return blocked;
    const alwaysOn = cloud() || !!hostedSearch(storage).on;
    appLog('dispatch', 'prepare top matches', {where: alwaysOn ? 'cloud' : 'mac'});
    const readiness = readinessOf(storage);
    if (!readiness) return {text: '⚠️ Apply readiness is not ready yet. Try again in a moment.'};
    // Why (8 Nov 2026, code review of R2): one run at a time, as the engine task's lock did: a second press while it runs would draft the same kits again and spend the AI twice.
    // Taken before the jobs list's read (Gitar on #3630): a second press during that read must find it too.
    if (topRunning) return {text: 'Apply readiness on your top matches is already running.'};
    topRunning = true;
    let top = [];
    try {
      const jobs = (await jobsList(storage)).jobs || [], byCode = new Map(jobs.map(job => [job.code, job]));
      top = pickTop(jobs.filter(job => !job.kit), TOP_MATCHES).map(job => byCode.get(job.code));   // best first, as pickTop orders them
    } finally { if (!top.length) topRunning = false; }
    if (!top.length) return {text: 'Your top matches are ready to apply: nothing to prepare.'};
    if (alwaysOn) return cloudTop(readiness, top);
    readyTop(readiness, top).catch(error => log(`Apply readiness on the top matches failed: ${error.message}`)).finally(() => { topRunning = false; });
    return {text: `Checking apply readiness on your top ${top.length === 1 ? 'match' : `${top.length} matches`}.`};
  };
  // Always on: ONE readiness night for the top matches whose check is not stored yet, in our cloud browser, then each form through the step as it is read. A tracked run, so Stop, the Activity record and the result line work as for any task.
  // The press asks the site first (a refused credit or cap is said at once); a run taken out of the queue before its turn, or Stopped, ends the site's night too (code review of 3/4).
  const cloudTop = async (readiness, top) => {
    const toRead = [];
    for (const job of top) if (!(await readiness.storedCheck({url: job.url, posted_at: job.posted_at || ''}).catch(() => null))) toRead.push(job);   // a fresh check is not read, nor paid for, again
    const reader = toRead.length ? createCloudRead({storage, site: cloudSite, jobs: toRead, ownKey: ownKeyFor(storage.settings(), keysOf(storage)), log: appLog}) : null;
    const started = reader ? await reader.start() : {ok: true};
    if (!started.ok) { topRunning = false; return {text: `⚠️ ${started.error}`}; }
    if (reader) keepCloudRead(storage, reader);
    pipeline.work(storage, 'kits', log, async (tee, signal) => {
      let stopped = false;
      signal?.addEventListener('abort', () => { stopped = true; reader?.stop(); readiness.cancel(); });
      const results = [];
      for (const job of top) {
        if (stopped) break;   // the rest are not prepared: no kit draft for a run the person stopped
        results.push(await readiness.applyReadiness({url: job.url, code: job.code, title: `${job.title} · ${job.company}`, kit: false, posted_at: job.posted_at || ''}, {notices: 'all'}));
      }
      if (!stopped) tee(`Apply readiness: ${resultLine(classify(results))}`);
      return !stopped;
    }).then(outcome => { if (outcome?.removed) reader?.stop(); }).catch(error => { reader?.stop(); log(`Apply readiness on the top matches failed: ${error.message}`); }).finally(() => { if (reader?.pending()) reader.stop();   // Why (Gitar on #3648): a match whose kit failed never asks for its read; the site must stop reading and charging it
      keepCloudRead(storage, null); topRunning = false; });
    return {text: `Checking apply readiness on your top ${top.length === 1 ? 'match' : `${top.length} matches`} in our cloud browser.`};
  };
  let topRunning = false;   // Apply readiness on the top matches is running (from the press's list read to its last job)
  // Every Telegram command, from the app (the answer also goes to Telegram when connected).
  const COMMANDS = ['check', 'employers', 'run', 'today', 'applied', 'saved', 'insight', 'weekly', 'mail', 'scout', 'status', 'add', 'help'];
  ipcMain.handle('command', async (_, name, arg = '') => {
    if (name === 'kits') return prepareTopMatches();
    if (!COMMANDS.includes(name)) return {text: 'Unknown command'};
    const blocked = name === 'run' ? await allowanceBlock() : null;   // its own reason (no AI credit, trial over), never a fixed "trial is over"
    if (blocked) return {...blocked, text: `⚠️ ${blocked.error}`};
    try { return await telegram.runCommand(storage, name, arg, log, undefined, dispatchNote); } catch (error) { return {text: `⚠️ ${error.message}`}; }
  });
  // Jobs → Applied elsewhere: tracked like /add, but waited for, so the list shows it as Applied right away.
  ipcMain.handle('importJob', async (_, url) => {
    if (DEMO) return {ok: true, text: 'Added (demo): nothing was written.'};
    const gate = needsNotion('add');
    if (gate) return gate;
    try { return await pipeline.importJob(storage, url, log); } catch (error) { return {ok: false, text: error.message}; }
  });
  ipcMain.handle('addApplied', async (_, url, when = '', details = {}) => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.'};
    const gate = needsNotion('applied');
    if (gate) return gate;
    try { return await pipeline.addApplied(storage, url, when, log, details || {}); } catch (error) { return {ok: false, text: error.message}; }
  });
  // Settings → Application profile → Standard answers (read from Notion) and the Strategy page's data.
  ipcMain.handle('standardAnswers', async () => {
    try { return {ok: true, groups: questionLists.filterGroups(storage, await questions.standardAnswers(storage))}; } catch (error) { return {ok: false, error: error.message}; }
  });
  // Strategy's one Re-score (pages/strategy-rescore.js): every job scored with previous settings, each once (src/desktop_strategy.py rescore_outdated).
  ipcMain.handle('rescoreOutdated', async () => {
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'rescore-outdated']);
    return code === 0 ? {ok: true, ...JSON.parse(stdout.trim().split('\n').pop())} : {ok: false, error: 'Could not queue them (see the activity log)'};
  });
  // Strategy → "scored with other places" → Refresh: queues the ACTIVE jobs scored with other places (src/ai/locations.py); a change of places never does it alone.
  ipcMain.handle('refreshLocations', async (_, url) => {   // url: one job's drawer; none: every active one (Strategy)
    if (DEMO) return {ok: true, queued: 0};
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'refresh-locations', ...(url ? ['--url', String(url)] : [])]);
    return code === 0 ? {ok: true, ...JSON.parse(stdout.trim().split('\n').pop())} : {ok: false, error: 'Could not queue them (see the activity log)'};
  });
  // "Your search may be too narrow" (src/coverage.py): how much of the market the role keywords catch, and what adding a term would add.
  // The one-tap "why?" after Dismiss and the daily score snapshot (renderer/intel.js): counts for the product, on the Technical reports switch.
  ipcMain.handle('dismissReason', (_, input) => { getRecipeReporter()?.dismissal(String(input?.reason || ''), String(input?.bucket || '')); return {ok: true}; });
  ipcMain.handle('intelSnapshot', (_, list, hosts) => {
    const today = new Date().toISOString().slice(0, 10);
    if (DEMO || storage.settings().intelSnapshotDay === today) return {ok: true, skipped: true};
    // A list without any score or stage (read before Notion's rows came through) is sent, since the site keeps the latest, but does not use up the day.
    const useful = intelLib.informative(list);
    if (useful) storage.saveSettings({intelSnapshotDay: today});
    appLog('intel', `snapshot ${useful ? 'sent' : 'sent, but only unscored/new jobs, so the day stays open'}`, {bands: Array.isArray(list) ? list.length : 0});
    getRecipeReporter()?.snapshot(list);
    getRecipeReporter()?.sources(applicationOutcomes.sourceStats(hosts, controlEvents.boardName));
    return {ok: true};
  });
}
