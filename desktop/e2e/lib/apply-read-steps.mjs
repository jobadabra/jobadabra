/* global document, window */
// The apply suite's triage-read step (spec 2026-10-30-apply-triage, PR C2a): the Jobs button reads a fixture job's form in the app's hidden browser, the chip shows the verdict, and the read never fills.
// Why (30 Oct 2026, a8 on #2602): a behaviour change carries its e2e step in the same PR; the unit tests fake the browser, this one plays the owner's press end to end. The judge is the suite's stand-in (a model that reads the sketch).
// Job: wait on state
import {INSTRUCTIONS as FORM_JUDGE} from '../../lib/form-judge.js';
import {FORMS} from './forms.mjs';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';
import {HIDDEN_NEED, autoFormOf, closeHiddenBrowser, describeHidden, evaluateOn, hiddenTargets, linkRuntime, withFormJudge} from './background-proof.mjs';
import {pollUntil, stepTimeLeft, stepWait} from './wait-on-state.mjs';
import {assertReadUntyped, sampleBeforeClose, TYPED_SNAPSHOT} from './typed-recorder.mjs';
import {CHIP_VALUE, CHIP_WORDS, sessionsNow} from './apply-triage-steps.mjs';

/** The http pages the hidden browser of `profile` holds, [] when it is not running. */
const hiddenPages = profile => hiddenTargets(profile).then(targets => targets.filter(item => item.type === 'page' && /^https?:/.test(item.url)), () => []);
const onHost = host => item => { try { return new URL(item.url).host === host; } catch { return false; } };

/**
 * Observe the form until stopped, retaining transient writes since attachment; the judge checkpoint reads it once more before the close path.
 * Why (30 Oct 2026, owner): target discovery follows browser startup, so this fallback cannot prove the interval before attachment or after the final read.
 */
function watchHiddenForm(profile, host) {
  const seen = {samples: 0, installed: 0, filled: [], expired: false};
  let stopped = false;
  const sample = async () => {
    const form = (await hiddenPages(profile)).find(onHost(host));
    const snapshot = form ? await evaluateOn(form.webSocketDebuggerUrl, TYPED_SNAPSHOT) : null;
    if (snapshot) {
      seen.samples += 1;
      if (snapshot.installed === true) seen.installed += 1;
      seen.filled.push(...(snapshot.filled || []));
    }
    return snapshot?.installed === true;
  };
  // Wait on the explicit stop state while observing the open page; the cap catches a stuck read, never proves it read-only.
  const done = pollUntil(async () => { if (!stopped) await sample(); return stopped; }, value => value,
    {capMs: stepTimeLeft(), tickMs: 25, log: () => {}}).then(result => { seen.expired = !result.value; });
  return {seen, sample, stop: () => { stopped = true; return done; }};
}

/** The chip text of the Jobs row titled `title` (ac's chip selector, lib/apply-triage-steps.mjs), or ''. */
const chipOfRow = (page, title) => page.evaluate(({text, selector}) => [...document.querySelectorAll(selector)].find(chip => chip.closest('.role')?.textContent.includes(text))?.textContent.trim() || '', {text: title, selector: CHIP_VALUE});

/** The fixture job as the Jobs page holds it now: {stage: its stage in the page's list, chip: its row's chip}, '' for what is not there. */
const rowOf = (page, {url, title}) => page.evaluate(({link, text, selector}) => ({
  stage: (window.__jp?.shared?.allJobs || []).find(job => job.url === link)?.stage || '',
  chip: [...document.querySelectorAll(selector)].find(chip => chip.closest('.role')?.textContent.includes(text))?.textContent.trim() || ''}), {link: url, text: title, selector: CHIP_VALUE});

/**
 * Waits until the Jobs page shows the store's fresh copy of the fixture job (Saved, its row drawn), then holds that nothing read it yet. `read` -> {stage, chip}.
 * Why (3 Nov 2026, apply-1of3 red on main run 41558018005, green on the next run with the same step code): after a reload the page paints the last saved list
 * first (renderer/pages/jobs.js), where this form's job is still Applied from the submit step; since #3026 an Applied row's chip says N/A, which "any chip" took.
 * `wait`: as readState's.
 */
export async function chipBeforeRead(read, wait = {}) {
  const row = await readState('the Jobs list never showed the fixture job as Saved', read, seen => seen.stage === 'Saved' && seen.chip !== '', wait);
  if (row.chip !== CHIP_WORDS.notChecked) throw new Error(`the job already had a chip before any read: "${row.chip}"`);
}

/** Every chip text now on the Jobs list, for a failure message. */
const allChips = page => page.evaluate(selector => [...document.querySelectorAll(selector)].map(chip => chip.textContent.trim()), CHIP_VALUE);

/**
 * Wait until `accepts(read())` within the current step's deadline; a cap is only a hang failure, and the hang message names `why` and the last value read.
 * `wait`: pollUntil options over the step's own (a test's short cap). -> the accepted value.
 */
export async function readState(why, read, accepts, wait = {}) {
  const result = await pollUntil(read, accepts, {capMs: stepTimeLeft(), what: why, ...wait});
  // Why (Gitar on #2986; 3 Nov 2026, run 41558018005 said only "the job already had a chip"): a read that never answered leaves the starting value '', which two
  // checks accept, so a hung read is a failure whatever its value; a failure names the last value it read, when one came.
  if (result.hung || !accepts(result.value)) throw new Error(result.value === '' ? why : `${why}, last seen ${JSON.stringify(result.value)}`);
  return result.value;
}

/**
 * Runs both read verdicts using the harness context. Seeds and removes only its own fixture job per step; no form is filled or sent.
 * Skipped here, counted as skipped, where the hidden browser has no runtime link (Windows).
 */
export async function runReadSteps(ctx) {
  const {page, proxy, forms} = ctx;
  // Why (7 Nov 2026, owner, #3519: "we don't need to go through normal flow of applying… just to understand if it's a simple form and can be submitted automatically"): a read only looks at the form, so it makes no answer plan and the
  // "answers not saved" variant ("You review and submit") has no producer any more; the one step left proves a simple form reads the catalog's "Simple form" chip (sub-status: can apply automatically) without the form judge.
  // Updated 10 Nov 2026 (owner: "Steps also read words and timings from the app, never copies"): the step's name keeps its words (its identity in the coverage map); the chip it expects is the catalog's (CHIP_WORDS), so a renamed chip keeps the step's intent.
  for (const [form, named, expected] of [[autoFormOf(FORMS.submitter), 'Simple form', CHIP_WORDS.simpleForm]]) {
    await ctx.run('"See which jobs can apply automatically" reads a job\'s form in the hidden browser: ' + named + ', the tab closes, and nothing is filled or sent', async () => {
      const unlinked = linkRuntime(ctx.profile);
      if (unlinked) throw new Error(unlinked);
      const previous = proxy.canned(), judge = withFormJudge(previous, 'Submit Application');
      let asked = 0;
      await removeJobsByUrl(ctx, [form.url]);
      await addKitJob(ctx, {title: form.title, company: form.company, url: form.url, kit: null, fit: 90, stage: 'Saved', nextStep: ''});
      const watch = watchHiddenForm(ctx.profile, form.host);
      proxy.setCanned(async body => {
        const system = typeof body?.system === 'string' ? body.system : (body?.system || []).map(part => part.text || '').join('');
        if (system.startsWith(FORM_JUDGE)) {
          asked += 1;
          // Why (30 Oct 2026, owner): the extension plans after this judge checkpoint, then closes; observe continuously and sample before releasing the judge.
          await sampleBeforeClose(watch);
        }
        return judge(body);
      });
      try {
        await page.reload();
        await stepWait('the app window showed its view after the reload', timeout => page.locator('.view:not([hidden])').waitFor({timeout}));
        await page.click('.nav[data-view="jobs"]');
        await page.fill('#filter-text', form.url);   // Why (2026-10-30, CI run 41092478435): a Saved job is no row of the "New matches" view; a pasted link finds a job whatever its status (renderJobs `anyStatus`)
        await chipBeforeRead(() => rowOf(page, form));
        const sessions = sessionsNow(ctx), posted = forms.posts.length;
        await page.click('#triage-open');
        await stepWait('the triage dialog opened', timeout => page.waitForSelector('#triage-dialog[open]', {timeout}));
        await page.fill('#triage-n', '1');   // Why (2026-10-30, owner: the popup is becoming one field, the first N best matching jobs): the default "best" choice ranks by fit; this job is fit 90 and the suite's other fixture jobs sit below it, so the first 1 is this job
        await page.click('#triage-start');
        await readState('the chip never showed the form read', () => chipOfRow(page, form.title), chip => chip !== CHIP_WORDS.notChecked)
          .catch(async error => { throw new Error(`${error.message} | chips: ${JSON.stringify(await allChips(page))} | ${await describeHidden(ctx.profile)}`); });
        const chip = await chipOfRow(page, form.title);
        if (chip !== expected) throw new Error(`the fixture should read "${expected}", the chip says "${chip}"`);
        if (asked > 0) throw new Error('a read asked the form judge: it should only look at the form (extension/triage-look.js)');
        await readState('the read tab was never closed', async () => (await hiddenPages(ctx.profile)).filter(onHost(form.host)).map(tab => tab.url), open => !open.length);
        await watch.stop();
        assertReadUntyped(watch.seen);
        if (forms.posts.length !== posted) throw new Error('a read posted the form');
        if (sessionsNow(ctx) !== sessions) throw new Error('a read created or changed a session; it is not an application');
      } finally {
        await page.click('#triage-cancel').catch(() => {});   // a run still going would read on into the next hidden-browser step
        await stepWait('the triage progress went away', timeout => page.waitForSelector('#triage-progress', {state: 'hidden', timeout})).catch(() => {});
        await page.click('#triage-close').catch(() => {});
        await page.fill('#filter-text', '').catch(() => {});
        await watch.stop();
        proxy.setCanned(previous);
        await removeJobsByUrl(ctx, [form.url]).catch(() => 0);
        await closeHiddenBrowser(ctx.profile);
      }
    }, {safety: true, needs: [...ctx.needs, HIDDEN_NEED]});   // Why (2026-10-28, Gitar on #2364; safety: 31 Oct 2026, owner): a missing need is recorded as skipped, not passed; this step proves nothing is filled or sent, so it is never suspended
  }
}
