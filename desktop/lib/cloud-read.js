// Apply readiness's cloud read (cloud browser runner 3/4, spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): the second `readForm` the step takes, used only when Always on runs without
// the Mac. The forms of the top matches go to the site as ONE readiness night, the site's browser reads each, and this takes each read once (the site deletes it when taken, owner 8 Nov 2026: "Site holds it,
// encrypted") and hands it to the step, which judges and stores it exactly as it does a read made in Chrome on this Mac.
// Invariants: a read never fills or presses Submit; no read, question or page text is logged here (counts and words only); a read that never arrives (lost response, expired, the site's cap, Stop, the time limit)
// is a form that "could not be read", never a hang; nothing here keeps a read after it is handed over. Guard: test/unit/main/cloud-read.test.js.
import * as ready from './ready-site.js';

export const POLL_MS = 4000;
export const GIVE_UP_MS = 12 * 60 * 1000;   // the site's night runs about 30 s a form at most; 15 forms fit well inside
const unreadable = why => ({unreadable: true, why});
const siteId = job => (/^[\w.:-]{1,64}$/.test(String(job?.code || '')) ? String(job.code) : '');

/**
 * `jobs`: [{code, url, title, company}] (the top matches). `ownKey`: the person's own Claude key or '' (then the read is within their AI credit and the site's cap).
 * -> {start(), readForm(job), stop(), done}. `start()` -> {ok: true} or {ok: false, error}: the site's own words (credit used up, today's cap, not available).
 */
export function createCloudRead({storage, jobs, ownKey = '', site = ready, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, log = () => {}}) {
  const slots = new Map();   // job code → {promise, resolve, settled}
  for (const job of jobs) {
    const code = siteId(job);
    if (!code || slots.has(code)) continue;
    const slot = {settled: false};
    slot.promise = new Promise(resolve => { slot.resolve = value => { if (!slot.settled) { slot.settled = true; resolve(value); } }; });
    slots.set(code, slot);
  }
  const open = () => [...slots].filter(([, slot]) => !slot.settled);
  const settleAll = value => { for (const [, slot] of open()) slot.resolve(value); };
  let ended = false;

  function settle(taken) {
    const slot = slots.get(String(taken.job));
    if (!slot) return;
    if (taken.state === 'read' && taken.read) slot.resolve(taken.read);
    else slot.resolve(unreadable(taken.state === 'read' ? 'gone' : taken.why || taken.state));
  }

  async function poll() {
    const until = now() + GIVE_UP_MS;
    while (!ended && open().length) {
      const got = await site.readTake(storage).catch(() => ({ok: false}));
      if (got.ok) {
        for (const taken of got.reads || []) settle(taken);
        // Nothing left being read on the site and none handed over: what is still open was lost (a response that never arrived, a read past its day): at most once is the rule.
        if (!got.pending && !(got.reads || []).length) { log('cloud read: reads lost', {open: open().length}); settleAll(unreadable('lost')); break; }
      }
      if (now() > until) { log('cloud read: time limit', {open: open().length}); settleAll(unreadable('timeout')); break; }
      if (open().length) await wait(POLL_MS);
    }
  }

  let finish = () => {};
  const done = new Promise(resolve => { finish = resolve; });
  return {
    async start() {
      if (!slots.size) return {ok: false, error: 'No job to check.'};
      const sent = await site.readSend(storage, jobs.filter(job => slots.has(siteId(job))).map(job => ({id: siteId(job), url: job.url, title: String(job.title || ''), company: String(job.company || '')})), {ai: ownKey});
      if (!sent.ok) return {ok: false, error: sent.error};
      const started = await site.readStart(storage);
      if (!started.ok) return {ok: false, error: started.error};
      poll().catch(() => settleAll(unreadable('failed'))).finally(() => finish());
      return {ok: true};
    },
    /** The step's `readForm(job)`: the read of this job's form, resolved when the site's night reports it; null for a form not in the batch. */
    readForm: job => slots.get(siteId(job))?.promise ?? null,
    /** How many forms are still waiting for the site's read: after the run's loop, a form whose kit failed is never awaited, so the night must end or it keeps reading and charging for it. */
    pending: () => open().length,
    /** Stop (the Stop button or the app closing): the site ends its night and every open form is told "could not be read". */
    async stop() {
      ended = true;
      settleAll(null);
      await site.readStop(storage).catch(() => {});
      finish();
    },
    done,
  };
}
