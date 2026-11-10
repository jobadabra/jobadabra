/* global document */
// The apply suite's real triage progress and Cancel proof: the fixture server holds each page until released, so every press follows a state, never a delay.
// Job: wait on state
import {FORMS} from './forms.mjs';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';
import {HIDDEN_NEED, autoFormOf, closeHiddenBrowser, hiddenTargets, linkRuntime, sessionOf, skipJob, withFormJudge} from './background-proof.mjs';
import {CHIP_VALUE, CHIP_WORDS} from './apply-triage-steps.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';
import {messages as shortJobs} from '../../i18n/catalogs/pages/short-jobs.js';
import {SILENT_MS} from '../../lib/triage-reader.js';

/**
 * True when the dialog's progress line names job `n` of `total` by its title. The words come from the catalog line the dialog paints (m203), so a renamed check keeps this step's intent.
 * Why (#3630, 8 Nov 2026): R2 renamed the progress line on purpose (spec 2026-11-07-apply-readiness-design.md, UI names) and a hand-typed prefix here turned main red.
 */
export const namesJob = (text, n, total, title) => text.startsWith(shortJobs.en.m203.replace('{seen}', n).replace('{length}', total)) && text.includes(title);

/**
 * Which side a held read's red was on, from three monotonic times in ms (null = never): the first poll that saw the dialog name job `n`, its page's GET at the fixture, the step's release.
 * The app ends a read silent for SILENT_MS (lib/triage-reader.js), so "the browser never asked" and "the step held it too long" are told apart instead of one "never named" line.
 * Why (night burn-in 42721065574, 10 Nov 2026): the hidden browser made no request for job 2 in 30 s while the step polled every ~270 ms; the old message read like the step's fault.
 */
export function heldVerdict({n, namedAt, requestedAt, releasedAt, now, silentMs = SILENT_MS}) {
  const s = ms => `${(ms / 1000).toFixed(1)} s`, limit = `the app ends a read silent for ${s(silentMs)}`;
  if (namedAt === null) return `the dialog never named job ${n}`;
  if (requestedAt === null) return `the hidden browser never asked for job ${n}'s page in the ${s(now - namedAt)} the dialog named it (${limit})`;
  const held = (releasedAt ?? now) - requestedAt;
  if (held > silentMs) return `the step held job ${n}'s page ${s(held)}, past the app's silence end (${limit})`;
  return `job ${n}'s page was asked for ${s(requestedAt - namedAt)} after the dialog named it and held ${s(held)}`;
}

/** Waits on a state for as long as the step's hang cap leaves (stepTimeLeft: no clock of its own); throws what it waited for, its last read and, when given, `seen.why()`. */
async function waitOn(seen, what, read, accepts) {
  seen.what = what;
  console.log(`  triage: ${what}`);
  const {value} = await pollUntil(async () => (seen.state = await read()), accepts, {capMs: stepTimeLeft(), log: () => {}});
  if (!accepts(value)) throw new Error(`${what} (last read: ${JSON.stringify(seen.state)})${seen.why ? ` | ${seen.why()}` : ''}`);
  return value;
}

/** Progress and per-address chip words from the real Jobs window, including rows hidden behind the popup. */
const screenOf = (page, urls) => page.evaluate(({urls, selector}) => ({
  shown: !document.getElementById('triage-progress').hidden,
  text: document.getElementById('triage-progress-text').textContent.trim(),
  width: document.getElementById('triage-bar').style.width,
  chips: urls.map(url => [...document.querySelectorAll('.job-row')].find(row => row.dataset.url === url)?.querySelector(selector)?.textContent.trim() || ''),
}), {urls, selector: CHIP_VALUE});

/** The runner's hang report: last state, exact per-job GET counts, field reports and the hidden browser's targets. */
const hangOf = seen => () => `${seen.what} (last read: ${JSON.stringify(seen.state)})${seen.why ? ` | ${seen.why()}` : ''} | reads: ${JSON.stringify(seen.held?.reads)} | field reports: ${JSON.stringify(seen.held?.reports)}`;   // evidence; the runner says it was cut off

/** Runs one triage proof with four fixture jobs; removes the suite's fixture urls first so only this run's jobs can be picked. No application is started. */
export async function runTriageCancelSteps(ctx, {urls}) {
  const {page, proxy, forms} = ctx, seen = {what: '', state: null};
  const jobs = [1, 2, 3, 4].map(n => ({...autoFormOf(FORMS.submitter, `?triage-cancel=${n}`), title: `Triage Cancel Engineer ${n}`}));
  const addresses = jobs.map(job => job.url);
  await ctx.run('the triage bar moves per real read and Cancel during a held read stops before the next job, closes its page, and fills or sends nothing', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    const previous = proxy.canned(), held = forms.holdReads(jobs);
    seen.held = held;
    proxy.setCanned(withFormJudge(previous, 'Submit Application'));
    try {
      await closeHiddenBrowser(ctx.profile);
      await removeJobsByUrl(ctx, [...urls, ...addresses]);
      for (const [index, job] of jobs.entries()) await addKitJob(ctx, {...job, kit: null, fit: 100 - index, stage: 'Saved', nextStep: ''});
      await page.reload();
      await waitOn(seen, 'the Jobs navigation never appeared', () => page.locator('.nav[data-view="jobs"]').isVisible(), shown => shown);
      await page.click('.nav[data-view="jobs"]');
      await page.fill('#filter-text', jobs[0].url.split('?')[0]);
      await waitOn(seen, 'the four fixture chips never appeared unchecked', () => screenOf(page, addresses), state => state.chips.every(chip => chip === CHIP_WORDS.notChecked));
      for (const job of jobs) if (await sessionOf(page, job.url)) throw new Error(`a session already holds ${job.url}`);
      const posted = forms.posts.length;
      await page.click('#triage-open');
      await page.fill('#triage-n', String(jobs.length));
      await page.click('#triage-start');
      await waitOn(seen, 'Check never opened the first held page with progress visible', async () => ({screen: await screenOf(page, addresses), reads: [...held.reads]}), state => state.screen.shown && state.reads.includes(addresses[0]));

      for (const completed of [1, 2]) {
        held.release(addresses[completed - 1]);
        const n = completed + 1, url = addresses[completed];
        let namedAt = null;
        seen.why = () => heldVerdict({n, namedAt, requestedAt: held.times.find(time => time.url === url)?.at ?? null, releasedAt: held.releasedAt(url), now: performance.now()});
        const named = text => namesJob(text, n, jobs.length, jobs[completed].title);
        const state = await waitOn(seen, `the dialog never named job ${n} of ${jobs.length} while its read was held`, async () => {
          const screen = await screenOf(page, addresses);
          if (namedAt === null && named(screen.text)) namedAt = performance.now();
          return {screen, reads: [...held.reads]};
        }, state => named(state.screen.text) && state.reads.includes(url));
        seen.why = null;
        const width = `${Math.round(completed / jobs.length * 100)}%`;
        if (!state.screen.shown || state.screen.width !== width) throw new Error(`after ${completed} real reads the bar should show ${width}: ${JSON.stringify(state)}`);
        console.log(`  triage progress: ${state.screen.text}, bar ${state.screen.width}`);
      }
      // The third GET is still unanswered. Even its loading page must disappear on Cancel; a blank target is still a held page.
      await waitOn(seen, 'the hidden browser never held the in-flight read', () => hiddenTargets(ctx.profile).then(targets => targets.filter(target => target.type === 'page')), pages => pages.length > 0);
      await page.click('#triage-cancel');
      await waitOn(seen, 'Cancel never ended the run and hid its bar', () => screenOf(page, addresses), state => !state.shown);
      const stopped = await screenOf(page, addresses);
      if (stopped.chips.slice(0, 2).some(chip => !chip || chip === CHIP_WORDS.notChecked)) throw new Error(`the completed reads never changed their chips: ${JSON.stringify(stopped)}`);
      if (stopped.chips.slice(2).some(chip => chip !== CHIP_WORDS.notChecked)) throw new Error(`Cancel changed an unread job's chip: ${JSON.stringify(stopped)}`);
      const counts = addresses.map(url => held.reads.filter(read => read === url).length);
      if (JSON.stringify(counts) !== '[1,1,1,0]') throw new Error(`Cancel read another job or repeated a read: per-address GET counts ${JSON.stringify(counts)}`);
      if (forms.posts.length !== posted) throw new Error('triage posted a fixture form');
      if (held.reports.some(report => report.filled !== 0)) throw new Error(`triage filled controls: ${JSON.stringify(held.reports)}`);
      if (!addresses.slice(0, 2).every(url => held.reports.some(report => report.url === url))) throw new Error('the completed pages never reported their empty fields: the no-fill proof saw nothing');
      for (const job of jobs) if (await sessionOf(page, job.url)) throw new Error(`triage left a session for ${job.url}`);
      await waitOn(seen, 'Cancel left a hidden page open while its response was held', () => hiddenTargets(ctx.profile).then(targets => targets.filter(target => target.type === 'page')), pages => pages.length === 0);
    } finally {
      await page.evaluate(() => document.getElementById('triage-cancel')?.click()).catch(() => {});
      await closeHiddenBrowser(ctx.profile);
      held.close();
      for (const job of jobs) await skipJob(page, job);
      await removeJobsByUrl(ctx, addresses);
      await page.evaluate(() => document.getElementById('triage-close')?.click()).catch(() => {});
      await page.fill('#filter-text', '').catch(() => {});
      proxy.setCanned(previous);
    }
  }, {safety: true, needs: [...ctx.needs, HIDDEN_NEED], hangError: hangOf(seen)});
}
