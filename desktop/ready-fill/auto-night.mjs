// The Full automation task of the cloud runner (`auto`; spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto"; owner, 10 Nov 2026: "Build it now (Recommended)", "~500/day + alert (Recommended)"):
// one browser, each queued job's form opened, filled and judged by the extension the way the Mac's hidden browser does it (auto-commands.mjs answers as the Mac's controller), and pressed at most once, only through
// submit-gate.js after the site reserved its attempt. The net (no-submit.mjs) refuses every send but that job's own pages during its permit; a 401/403/429 ends the job. Jobs run one at a time, each to its outcome.
// The site hears per job {task: auto, state: submitted | not_submitted | unknown | failed, why, attempt, proof, ms, costMicro}; the log has words and counts only, never a field value or an address.
// Loaded by night.mjs only for this task. Guard: desktop/test/unit/ready-fill/auto-night.test.js; the real press on a local fixture: desktop/integration/extension/auto-night-press.test.mjs.
import fs from 'node:fs';
import {AUTO_OWNER, PRESS_WINDOW_MS, createAutoLine} from './auto-commands.mjs';
import {openNightBrowser} from './night-browser.mjs';
import {net} from './no-submit.mjs';
import {POLL, pageKindAnswer} from './read-night.mjs';
import {createStandIn} from './stand-in.mjs';
import {BLOCKED_STATUS} from './submit-gate.js';

export const JOB_SECONDS = 300;   // hang guard per job before its own wait: the fill, the judge and the receipt (a fill that ends at all does so in 1-3 minutes on the Mac)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pageOf = request => { try { return request.frame()?.page() || null; } catch { return null; } };   // a service worker's request has no frame

const mainFrame = request => { try { return !request.frame().parentFrame(); } catch { return false; } };
// A navigation of the job's own page that answered 401, 403 or 429 tells the line (auto-commands.mjs blocked: before the press the job ends there). An iframe's answer is not the page's.
function refusedBy(response, auto) {
  const request = response.request();
  if (request.isNavigationRequest() && mainFrame(request) && BLOCKED_STATUS.includes(response.status())) auto.blocked(response.status());
}

/**
 * Waits for one job's outcome: its tab is asked for (or the job was stopped at once), its recheck handed out when its wait runs out, a Stop heard every 5 ticks; at `deadline` it ends as not sent (or `unknown` after a press).
 * A press gets its permit's time for the receipt past the deadline; an end that waits for /reserve's answer gets PRESS_WINDOW_MS more, then the job is `unknown`.
 */
async function untilOutcome({auto, onStep, kick, deadline, tick, now}) {
  if (await onStep('opening')) { auto.stop(); return; }
  await kick();
  for (let n = 1; !auto.outcome() && now() < Math.max(deadline, auto.until()); n++) {
    await pause(tick);
    if (auto.dueAt() && now() >= auto.dueAt()) await kick();   // the wait ran out: the poll hands the extension its recheck
    if (n % 5) continue;
    if (await onStep(auto.attempt() ? 'submitting' : 'filling') && auto.stop()) return;   // after the press a Stop changes nothing
  }
  if (!auto.outcome()) auto.end('not_submitted', 'timeout');   // after a press, end() makes this `unknown`
  for (const settle = now() + PRESS_WINDOW_MS; !auto.outcome() && now() < settle;) await pause(tick);   // /reserve still in flight: its answer decides
  if (!auto.outcome()) auto.abandon();
}

/**
 * Runs every job of an auto `batch` in turn. `tell` speaks to the site: result(body) -> its answer ({stop} ends the night), stepper(jobId) -> onStep(step) answering true when the owner stopped it,
 * stopped(jobId) -> true when the site says this job was stopped (asked right before a reservation), reserve(jobId) -> {ok, attempt} | {ok: false, error}, over() -> true once the night has ended, costMicro(ms).
 * `client` is the model client (night-ai.mjs siteClient), `answer` the stand-in's /extension/answer (night-ai.mjs answererFor). -> {results: Map(jobId -> outcome), guard}. Everything it opened is closed when it returns or throws.
 */
export async function autoAll({batch, chromium, extensionDir, tell, client, answer = null, told = new Set(), log = () => {}, extraArgs = [], launchOptions = {}, jobSeconds = JOB_SECONDS, tick = 1000, now = Date.now, line = null}) {
  let pages = new Set();
  const auto = line || createAutoLine({client, reserve: id => tell.reserve(id), stopped: () => tell.stopped(current?.id), sentAt: batch.sentAt, now});
  let current = null;
  const standIn = await createStandIn(batch, {answer, background: body => auto.background(body), pageKind: pageKindAnswer(client),
    routes: {'/extension/account-judge': body => auto.formJudge(body), '/extension/confirmation': body => auto.confirmation(body)}});
  let opened;
  try { opened = await openNightBrowser({chromium, standIn, extensionDir, extraArgs, launchOptions, owned: true, storage: {backgroundOwner: AUTO_OWNER}}); }
  catch (error) { await standIn.close().catch(() => {}); throw error; }
  const {context, worker, profile} = opened, results = new Map();
  const kick = () => worker.evaluate(POLL).catch(() => {});   // a refused kick only waits for the extension's own poll
  try {
    // The one way through the net: a send from this job's own pages while its permit lasts (auto-commands.mjs PRESS_WINDOW_MS).
    // Why (10 Nov 2026, cs 3/4 review): a page that sends itself before the press (a form posting each step) can never go on here; the person finishes it, instead of AI calls until the hang guard.
    const guard = await net(context, {allow: request => auto.pressing() && pages.has(pageOf(request)),
      refused: request => { if (!auto.attempt() && request.isNavigationRequest() && mainFrame(request) && pages.has(pageOf(request))) auto.end('not_submitted', 'page_sends_early'); }});
    context.on('page', page => { if (current) pages.add(page); });
    context.on('response', response => { if (pages.has(pageOf(response.request()))) refusedBy(response, auto); });
    for (const job of batch.jobs) {
      const started = now(), onStep = tell.stepper(job.id);
      current = job; pages = new Set(); auto.begin(job); standIn.reset(job.url);
      try {
        // Why (10 Nov 2026, cs 3/4): the job's own wait is part of its time (the Mac waits the same before its press); jobSeconds is only a hang guard.
        await untilOutcome({auto, onStep, kick, deadline: started + jobSeconds * 1000 + (Number(job.item?.waitMin) || 0) * 60000, tick, now});
      } catch (error) {   // the browser failed under this job: a press it may have made is `unknown`, never "failed"
        auto.end('failed', 'error');
        await report(job, started);
        throw error;
      } finally {
        current = null;
        for (const page of pages) await page.close().catch(() => {});
      }
      if (auto.outcome().state === 'stopped') {   // the owner stopped it before any press: nothing is reported, the site already put the row back
        told.add(job.id); log('job stopped', {id: job.id});
        if (await tell.over()) { log('the night is over'); break; }
        continue;
      }
      const said = await report(job, started);
      log('job', {id: job.id, state: auto.outcome().state, why: auto.outcome().why, ms: now() - started, allowed: guard.allowed, blocked: guard.blocked.length});
      if (said?.stop) { log('stopped by the Worker (cost cap or finished)'); break; }
    }
    return {results, guard};
  } finally {
    await context.close().catch(() => {}); await standIn.close().catch(() => {});
    fs.rmSync(profile, {recursive: true, force: true});
  }

  async function report(job, started) {
    const outcome = auto.outcome(), ms = now() - started;
    results.set(job.id, outcome);
    const said = await tell.result({job: job.id, task: 'auto', state: outcome.state, why: outcome.why, attempt: auto.attempt(), proof: auto.proof(), ms, costMicro: tell.costMicro(ms)}).catch(() => ({}));
    told.add(job.id);
    return said;
  }
}
