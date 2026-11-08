/* global window, document */
// The apply suite's triage steps (spec 2026-10-30-apply-triage, PR B): the Jobs button's popup has one field (the first N best matching jobs not checked before), and a job nobody has read says "Not checked".
// Why (30 Oct 2026, owner: "work on the apply-triage e2e"): the popup and its chips had unit tests only; no step pressed the button in the real window. The form read is PR C: until it lands
// a run reads nothing, so a step also holds that nothing opened, filled or sent. Fictional jobs only; the progress bar and Cancel have no step until a read can be slow (PR C).
// Job: wait on state
import fs from 'node:fs';
import path from 'node:path';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';
import {showFilter} from './jobs-filter.mjs';
import {stepWait} from './wait-on-state.mjs';

// Twelve jobs with fits the popup must order: more than the 10 it takes, every one with a distinct fit.
const FITS = [96, 93, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72];
const JOBS = FITS.map((fit, index) => ({fit, title: `Triage Engineer ${index + 1}`, company: 'Triage Fixture Co', url: `https://jobs.triage-fixture.example/roles/${index + 1}`}));

/** The chip on each Jobs row: the selector both triage steps read (renderer/pages/jobs-render.js `.role > .chip-tag`). */
export const CHIP_VALUE = '.role > .chip-tag .chip-value';

const sessionsFile = ctx => path.join(ctx.profile, 'sessions.json');
/** The saved sessions file as text ('' when none): a step compares it before and after to prove nothing started. */
export const sessionsNow = ctx => { try { return fs.readFileSync(sessionsFile(ctx), 'utf8'); } catch { return ''; } };

/** Opens Jobs with the fictional jobs listed (the list is read again from the store, never the page's older copy). */
async function openJobs(ctx) {
  const {page} = ctx;
  await page.reload();
  await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
  await page.click('.nav[data-view="jobs"]');
  await page.waitForFunction(urls => urls.every(url => (window.__jp?.shared?.allJobs || []).some(job => job.url === url)), JOBS.map(job => job.url), {timeout: 60000, polling: 500})
    .catch(() => { throw new Error('the Jobs list never held the twelve fictional jobs'); });
}

/** Runs the triage steps; takes the harness context. Seeds and removes only its own twelve jobs. */
export async function runTriageSteps(ctx) {
  const {page} = ctx;
  const urls = JOBS.map(job => job.url);
  try {
    // The Jobs popup's one field, and how many jobs it says it will check: integration/app/screen-apply.test.js (moved 1 Nov 2026).
    // Why (8 Nov 2026, #3573 Apply readiness, owner 7 Nov 2026: "One step does all 3 of them"): the check drafts a missing kit first; these fixtures' postings cannot be reached, so the kit fails and the person is told why on each row, never a guessed mode.
    await ctx.run("checking jobs before the form read exists guesses no mode: a job whose kit cannot be drafted says \"Couldn't read\" with its reason, no session starts, nothing is filled or sent", async () => {
      await removeJobsByUrl(ctx, urls);
      for (const job of JOBS) await addKitJob(ctx, {title: job.title, company: job.company, url: job.url, kit: null, fit: job.fit, stage: 'Saved', nextStep: ''});
      await openJobs(ctx);
      // These fixtures are Saved jobs; the default New matches filter excludes them.
      await showFilter(page, 'saved');
      await stepWait('the twelve Saved triage rows to render', timeout => page.waitForFunction(urls => urls.every(url => [...document.querySelectorAll('article.job-row')].some(row => row.dataset.url === url)), urls, {timeout}));
      const before = sessionsNow(ctx);
      await page.click('#triage-open');
      await page.waitForSelector('#triage-dialog[open]', {timeout: 5000});
      await page.click('#triage-start');
      // Why (8 Nov 2026, flaky on e26df24 vs a35ac61, run 42451539978): the check's own kit drafts end in their own run toasts ("Application preparation had problems"), which land
      // whenever each draft's posting fetch fails; the step read the last toast as soon as any appeared. It now waits for the check's own toast, by its end titles, which only its end shows (jobs-triage.js).
      const toasts = page.locator('.toast').filter({hasText: /Nothing was checked|Checked your jobs/});   // the check's own end titles (pagesControlStatus.nothingChecked, checkedJobs); "Gmail check not checked" is another toast
      await stepWait('the check\'s own toast', timeout => toasts.first().waitFor({state: 'visible', timeout})).catch(async error => {
        const seen = await page.locator('.toast').allInnerTexts();
        throw new Error(`pressing "Check jobs" told the person nothing about the check (toasts seen: ${JSON.stringify(seen)}): ${error.message}`);
      });
      const told = (await toasts.last().innerText()).replace(/\s+/g, ' ');
      if (!/couldn't be read/i.test(told)) throw new Error(`with no form read and no kit the toast should say the jobs couldn't be read, it says "${told}"`);
      if (await page.locator('#triage-progress:visible').count()) throw new Error('the progress bar is still showing after the run');
      await page.click('#triage-close').catch(() => {});
      const chips = await page.evaluate(selector => [...document.querySelectorAll(selector)].map(chip => chip.textContent.trim()), CHIP_VALUE);
      if (!chips.length) throw new Error('no job row shows a triage chip (.role > .chip-tag, renderer/pages/jobs-render.js)');
      const odd = chips.filter(text => text !== 'Not checked' && text !== "Couldn't read");
      if (odd.length) throw new Error(`${odd.length} chip(s) guessed a mode without a read: ${[...new Set(odd)].join(', ')}`);
      if (sessionsNow(ctx) !== before) throw new Error('checking jobs started or changed a session; nothing may open, fill or send before the form read exists');
    }, {safety: true});
  } finally {
    await removeJobsByUrl(ctx, urls).catch(() => 0);
  }
}
