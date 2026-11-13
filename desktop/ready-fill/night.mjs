// The night's run (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): read the batch with the night token, start ONE browser with the night's copy of the extension and the stand-in app, fill each job in its own tab, one after the other,
// post only counts to the Worker after each (it can answer "stop": the night's cost cap), and keep every filled tab open for the morning. A fill or a read never presses Submit or an account button (extension-copy.mjs, no-submit.mjs); only the `auto` task may press, once per job, through submit-gate.js (auto-night.mjs).
// Counts only leave this file: no field value, no address in a log. Guard: desktop/test/unit/ready-fill/ready-fill.test.js; the one-night image check is hosted/ready-fill/image-check.mjs in jobadabra-web.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fillJob} from './fill-job.mjs';
import {discard} from './fill-video.mjs';
import {handoff as handoffOf} from './live.mjs';
import {answererFor, siteClient} from './night-ai.mjs';
import {openNightBrowser} from './night-browser.mjs';
import {net} from './no-submit.mjs';
import {createStandIn} from './stand-in.mjs';

export const EXTENSION_DIR = process.env.EXTENSION_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
// Pure: what a job cost us, micro-USD: the container's seconds (standard-1: 4 GiB memory + 8 GB disk + CPU, measured ≈ $0.000012 a second) plus the AI the extension reported.
export const costMicro = (ms, usd = 0) => Math.round((Number(ms) || 0) / 1000 * 12 + (Number(usd) || 0) * 1e6);

// Why a night failed, for the owner's /state (behind the night token) and the log: the error's first words, with any address cut out (counts and words only).
export const why = error => String(error?.message || error).replace(/\b(?:https?|wss?):\/\/\S+/g, '<address>').split('\n')[0].slice(0, 160);

// The fill's video to the site (Watch the fill): sealed there, deleted with the job's data. A failed upload loses only the video. -> the HTTP status, or 0.
export async function sendVideo(fetchImpl, site, token, job, video) {
  if (!video?.path) return 0;
  try {
    const response = await fetchImpl(`${site}/api/ready/video?job=${encodeURIComponent(job)}&secs=${video.secs}`, {method: 'PUT', headers: {authorization: `Bearer ${token}`, 'content-type': 'video/webm'}, body: fs.readFileSync(video.path)});
    return response.status;
  } catch { return 0; } finally { discard(video.path); }
}

// A held form's hand-off to the site (Open in my browser after the container is gone; owner, 18 Oct 2026: "Yes, sealed, 24 h max"): the page, its storage and its fields,
// sealed there and deleted with the form's data. Read now, while the tab is fresh; a failed read or upload loses only the stored copy. -> the HTTP status, or 0.
// night: what the morning replays instead of judging again (owner, 18 Oct 2026: "It should be all cached... instant"): the page's role and the night's AI answers.
export async function sendHandoff(fetchImpl, site, token, job, page, read = handoffOf, night = {}) {
  if (!page) return 0;
  try {
    const body = JSON.stringify({...await read(page), night});
    const response = await fetchImpl(`${site}/api/ready/handoff?job=${encodeURIComponent(job)}`, {method: 'PUT', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body});
    return response.status;
  } catch { return 0; }
}

// Pure: the job's log line: counts, words and upload statuses only, never a field value, an address or a cookie.
export const jobLine = ({id, done, blocked, video, handoff}) => ({id, state: done.state, filled: done.filled, left: done.left, ms: done.ms, blocked,
  video: done.video ? {bytes: done.video.bytes, secs: done.video.secs, sent: video} : null, handoff});

// Pure: a container holding no night (a fresh one the site woke after a deploy, or one already closed) answers "gone" (410) on the morning's calls, so the runner stops it again.
export const gone = (night, status) => !night && status.state === 'idle';

async function post(fetchImpl, site, token, route, body) {
  const response = await fetchImpl(`${site}/api/ready/${route}`, {method: body ? 'POST' : 'GET', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  return response.json().catch(() => ({}));
}

// The cloud runner's tasks (spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): `fill` is Ready to send's night (the default, so a run that names none is unchanged), `readiness` reads each form only,
// `auto` is Full automation from the cloud: each job pressed at most once, only through submit-gate.js (auto-night.mjs). Any other name is refused before the batch is read.
// Why (10 Nov 2026, cs 3/4; owner: "Build it now (Recommended)"): `auto` became a task with its gate and guard (cs 1/4) and the site's stamps and reservation (cs 2/4) in place.
// Why (owner, 13 Nov 2026: "lets' keep Linkedin and Google sessions/credentials windows/mac only"): the `linkedin` probe task (ap 1/6) is gone; the site refuses it too (web).
export const TASKS = ['fill', 'readiness', 'auto'];

// chromium: Playwright's (main.mjs passes `playwright`'s; the fixture proof passes the desktop's), so this file loads without a browser package. task: one of TASKS.
// -> {held: Map(jobId -> page), context, close()} once every job has been tried (a fill's pages stay open); a read holds no page and also returns {results}.
export async function runNight({chromium, site, token, task = 'fill', fetchImpl = fetch, log = () => {}, fillSeconds = 120, extraArgs = [], launchOptions = {}, record = null, settleMs = 3000, readerOptions = {}}) {   // extraArgs/launchOptions: the fixture proof's host rules and certificate (proof.mjs)
  if (!TASKS.includes(task)) throw new Error(`unknown night task: ${String(task).slice(0, 20)}`);
  const batch = await post(fetchImpl, site, token, 'batch');
  const held = new Map(), told = new Set();   // told: the jobs whose result the site already has
  if (!batch.ok || batch.stop || !batch.jobs?.length) { log('nothing to do', {stop: !!batch.stop}); return {held, close: async () => {}}; }
  try {
    if (task === 'readiness') {
      // Why (8 Nov 2026, code review of cloud runner 1/4): loaded only for a read, so the fill night's image runs without the read's files (lib/triage-reader.js, ladder/rung2-sketch.js) until web 2/4 adds them.
      const {readAll} = await import('./read-night.mjs');
      const over = async () => { const again = await post(fetchImpl, site, token, 'batch').catch(() => ({})); return again.ok === false || !!again.error || !!again.stop; };
      const tell = {result: body => post(fetchImpl, site, token, 'result', body), stepper: job => stepper({fetchImpl, site, token, job}), costMicro: ms => costMicro(ms), over};
      const {results} = await readAll({batch, chromium, extensionDir: EXTENSION_DIR, tell, told, log, extraArgs, launchOptions, readerOptions, client: siteClient({site, token, fetchImpl})});
      return {held, results, close: async () => {}};
    }
    if (task === 'auto') return {held, ...await autoNight({batch, chromium, site, token, fetchImpl, log, told, extraArgs, launchOptions}), close: async () => {}};
    return await fillAll({told, batch, chromium, site, token, fetchImpl, log, fillSeconds, extraArgs, launchOptions, held, record, settleMs});
  } catch (error) {   // the night could not start or stopped: each job not yet told is told, so the card says so at once instead of "waiting" until the night's end
    const failed = task === 'readiness' ? {task, state: 'failed', read: null, why: NIGHT_FAILED, ms: 0, costMicro: 0} : task === 'auto' ? {task, state: 'failed', why: NIGHT_FAILED, ms: 0, costMicro: 0}   // auto: a job with a press already told itself (auto-night.mjs)
      : {state: 'failed', filled: 0, left: 0, humanCheck: false, wall: NIGHT_FAILED, ms: 0, costMicro: 0};
    for (const job of batch.jobs.filter(job => !held.has(job.id) && !told.has(job.id))) await post(fetchImpl, site, token, 'result', {job: job.id, ...failed}).catch(() => {});
    throw error;
  }
}

// The `auto` task (auto-night.mjs, loaded only for it): the site's calls with the night token: the job's one attempt (/reserve), its Stop (the live line's answer), each outcome (/result).
async function autoNight({batch, chromium, site, token, fetchImpl, log, told, extraArgs, launchOptions}) {
  const {autoAll} = await import('./auto-night.mjs');
  const over = async () => { const again = await post(fetchImpl, site, token, 'batch').catch(() => ({})); return again.ok === false || !!again.error || !!again.stop; };
  const tell = {result: body => post(fetchImpl, site, token, 'result', body), stepper: job => stepper({fetchImpl, site, token, job}), costMicro: ms => costMicro(ms), over,
    reserve: job => post(fetchImpl, site, token, 'reserve', {job}),
    stopped: async job => (await post(fetchImpl, site, token, 'progress', {job, step: 'submitting'})).stop === true};
  const client = siteClient({site, token, fetchImpl});
  return autoAll({batch, chromium, extensionDir: EXTENSION_DIR, tell, client, answer: await answererFor({batch, site, token, fetchImpl}), told, log, extraArgs, launchOptions});
}

// Pure: one press of a form (the night's first list, or a Fill again: the site counts its `turn` up). The container fills each press once, whatever the site
// answers, so a stale or wrong list of waiting forms fills nothing (PR #1455's image check: j1 six times).
export const pressOf = job => `${job.id}:${Number(job.turn) || 0}`;
export const NIGHT_FAILED = 'the night could not start';   // the word the card shows beside "could not fill"; the error itself stays in the container's /state and log
// clean-code-ok: Why (1 Nov 2026, rs 5a/6): a pure move from hosted/ (never checked) into desktop/; splitting this function is its own change, not part of the move.
async function fillAll({told, batch, chromium, site, token, fetchImpl, log, fillSeconds, extraArgs, launchOptions, held, record, settleMs}) {
  const standIn = await createStandIn(batch, {answer: await answererFor({batch, site, token, fetchImpl})});
  let profile = '', context = null;
  try { ({context, profile} = await openNightBrowser({chromium, standIn, extensionDir: EXTENSION_DIR, extraArgs, launchOptions})); }
  catch (error) { await standIn.close().catch(() => {}); throw error; }   // a setup that fails closes what it opened (the browser and profile: night-browser.mjs; the stand-in here), so the process can end
  const guard = await net(context);
  const close = async () => { await context.close().catch(() => {}); await standIn.close().catch(() => {}); fs.rmSync(profile, {recursive: true, force: true}); };
  // The night's forms in a line (owner, 18 Oct 2026): after each form the night is read again, and a form a Fill again added since joins the end of the line.
  const nights = new Map();   // job id -> what the morning replays (its role and AI answers), also for the container's own /handoff (main.mjs)
  const line = [...batch.jobs], taken = new Set();   // taken: the presses this night already filled (the floor in moreFor)
  while (line.length) {
    const job = line.shift();
    taken.add(pressOf(job));
    standIn.reset(job.url);
    await held.get(job.id)?.close().catch(() => {}); held.delete(job.id);   // filled again: its earlier tab goes
    const onStep = stepper({fetchImpl, site, token, job: job.id});
    const done = await fillJob({context, standIn, job, fillSeconds, onStep, settleMs, ...(record ? {record} : {})}).catch(error => ({state: 'failed', wall: 'error', filled: 0, left: 0, humanCheck: false, ms: 0, page: null, video: null, error: String(error).slice(0, 80)}));
    if (done.stopped) {   // the owner stopped it: nothing is reported (the site already put the row back), its tab and video go
      told.add(job.id); await done.page?.close().catch(() => {}); discard(done.video?.path);
      log('job stopped', {id: job.id});
      if (!await moreFor(line)) break;
      continue;
    }
    if (done.page && ['prepared', 'partial'].includes(done.state)) held.set(job.id, done.page); else await done.page?.close().catch(() => {});   // only a filled form is worth holding
    const usd = standIn.outcome(job.url)?.usd || 0;
    const video = await sendVideo(fetchImpl, site, token, job.id, done.video);   // before the result: the last result ends the night, and its token with it
    const night = {role: standIn.role(job.url), answers: standIn.said(job.url)};
    nights.set(job.id, night);
    const handoff = held.has(job.id) ? await sendHandoff(fetchImpl, site, token, job.id, done.page, undefined, night) : 0;   // likewise before the result
    const answer = await post(fetchImpl, site, token, 'result', {job: job.id, state: done.state, filled: done.filled, left: done.left, humanCheck: done.humanCheck, wall: done.wall, ms: done.ms, costMicro: costMicro(done.ms, usd)});
    told.add(job.id);
    log('job', jobLine({id: job.id, done, blocked: guard.blocked.length, video, handoff}));
    if (answer.stop) { log('stopped by the Worker (cost cap or finished)'); break; }
    if (!await moreFor(line)) break;
  }
  return {held, context, guard, standIn, nights, close};

  // Reads the night again: forms queued since join the line. -> false when the night is over (its token refused: finished or stopped by the owner).
  async function moreFor(queue) {
    const again = await post(fetchImpl, site, token, 'batch').catch(() => ({}));
    if (again.ok === false || again.error || again.stop) return false;
    if (again.line !== true) return false;   // a site from before the line returns every form, not only those waiting: the night is its first list
    for (const next of again.jobs || []) {
      if (queue.some(each => each.id === next.id)) continue;
      if (taken.has(pressOf(next))) { log('press already filled', {id: next.id}); continue; }   // a stale answer never refills a form
      standIn.add(next); queue.push(next);
    }
    return true;
  }
}

// The live line of one form: its step sent to the site when it changes or every 10 s, never page text. -> onStep(step, n): true when the owner stopped this form.
export function stepper({fetchImpl, site, token, job, now = Date.now}) {
  let last = '', at = 0;
  return async (step, n = null) => {
    if (`${step}:${n}` === last && now() - at < 10000) return false;
    last = `${step}:${n}`; at = now();
    const answer = await post(fetchImpl, site, token, 'progress', {job, step, ...(n == null ? {} : {n})}).catch(() => ({}));
    return answer.stop === true || answer.error === 'unauthorized';   // stopped, or the night is over (its token refused)
  };
}
