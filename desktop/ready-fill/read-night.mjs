// The read task of the cloud runner (`readiness`; spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): one browser, each job's form read once by the extension's own light read, the read the app's
// Apply readiness makes on the Mac (lib/triage-reader.js, read-commands.mjs), sent to the site; nothing is filled, pressed or held, and the no-submit net stays on.
// A read's flags and questions go to the site only (it keeps them encrypted and removes them once the app has read them: owner, 8 Nov 2026, "Site holds it, encrypted"); the log has words and counts only.
// Guard: desktop/test/unit/ready-fill/ready-read.test.js.
import fs from 'node:fs';
import {createTriageReader} from '../../desktop/lib/triage-reader.js';   // in the image: /desktop/lib, reached by the same path from /night
import {openNightBrowser} from './night-browser.mjs';
import {net} from './no-submit.mjs';
import {NIGHT_OWNER} from './read-commands.mjs';
import {createStandIn} from './stand-in.mjs';

// Run in the extension's worker: its ordinary background poll, so a queued read is taken at once instead of at the next tab report (every 30 s). The same call the Mac makes (lib/background-browser.js).
export const POLL = () => globalThis.__jobPilottoBackgroundSessions?.poll();

/** Pure: what the site is told about one read. `read` is the reader's answer: flags (and questions), {unreadable, why}, or null when it was cancelled. -> {state: read | unreadable | stopped, read, why}. */
export function readResult(read) {
  if (!read) return {state: 'stopped', read: null, why: ''};
  if (read.unreadable) return {state: 'unreadable', read: null, why: String(read.why || 'unreadable').slice(0, 40)};
  return {state: 'read', read, why: ''};
}

/**
 * Reads every job of `batch` in turn. `tell` speaks to the site: result(body) -> its answer ({stop} ends the night), stepper(jobId) -> onStep(step) answering true when the owner stopped that job, costMicro(ms).
 * `told` collects the jobs the site has heard about. readerOptions go to createTriageReader (a test's clock). -> {results: Map(jobId -> readResult), guard}. Everything it opened is closed when it returns or throws.
 */
export async function readAll({batch, chromium, extensionDir, tell, told = new Set(), log = () => {}, extraArgs = [], launchOptions = {}, readerOptions = {}, now = Date.now}) {
  let stepOf = () => {};
  const reader = createTriageReader({...readerOptions, onStep: ({step}) => stepOf(step)});
  const standIn = await createStandIn(batch, {reader});
  let opened;
  try { opened = await openNightBrowser({chromium, standIn, extensionDir, extraArgs, launchOptions, owned: true, storage: {backgroundOwner: NIGHT_OWNER}}); }
  catch (error) { await standIn.close().catch(() => {}); throw error; }
  const {context, worker, profile} = opened, results = new Map();
  try {
    const guard = await net(context);   // a read never sends a form: the night's net refuses one all the same
    for (const job of batch.jobs) {
      const started = now(), onStep = tell.stepper(job.id);
      let stopped = false, heard = Promise.resolve();
      stepOf = step => { heard = onStep(step).then(stop => { if (stop && !stopped) { stopped = true; reader.cancelAll(); } }, () => {}); };
      const reading = reader.read(job.url);
      await worker.evaluate(POLL).catch(() => {});   // a refused kick only waits for the extension's own poll
      const read = await reading;
      await heard;   // the site's answer to the read's last step: a Stop that crossed the read's end still stops it
      if (stopped) { told.add(job.id); log('job stopped', {id: job.id}); continue; }   // the owner stopped it: nothing is reported (as a stopped fill)
      const result = readResult(read), ms = now() - started;
      results.set(job.id, result);
      const answer = await tell.result({job: job.id, task: 'readiness', state: result.state, read: result.read, why: result.why, ms, costMicro: tell.costMicro(ms)});
      told.add(job.id);
      log('job', {id: job.id, state: result.state, why: result.why, questions: result.read?.questions?.length ?? 0, ms, blocked: guard.blocked.length});
      if (answer?.stop) { log('stopped by the Worker (cost cap or finished)'); break; }
    }
    return {results, guard};
  } finally {
    stepOf = () => {};
    reader.cancelAll();
    await context.close().catch(() => {}); await standIn.close().catch(() => {});
    fs.rmSync(profile, {recursive: true, force: true});
  }
}
