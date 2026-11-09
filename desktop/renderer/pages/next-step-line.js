// The line a finished Find jobs run's card says about what comes next, in the card's own summary line (plan P3, src/press/plan.py next_steps, lib/next-step.js).
// Why (8 Nov 2026, asked via AskUserQuestion, "Yes, as drawn (Recommended)"): "Next: employer sites (561 left to read), then job boards", with the number, and no second button
// ("No, one action (Recommended)"). This is the one count of work left a run result may carry: the 24 Oct 2026 rule (no internal counts, one number = jobs added) stands for every other count.
// Rules: only the newest finished Find jobs run's card, and only a plan that run made; no step -> no line; a count of 0 or never said -> no count; one step -> no "then"; a plan older than MAX_AGE_MS is not shown.
import {t} from '../../i18n/index.js';
import {number as displayNumber} from '../../i18n/format.js';
import '../../i18n/next-step.js';
import {newestSearch} from './browser-offer-rows.js';

export const MAX_AGE_MS = 3 * 24 * 3600 * 1000;   // = src/press/plan.py MAX_AGE_DAYS
const SLACK_MS = 5 * 60 * 1000;   // the run's own end bookkeeping (its record is closed a moment after the engine's last line)
const WORDS = {web_search: 'webSearch', job_boards: 'jobBoards', employer_sites: 'employerSites', free_job_apis: 'freeJobApis', google_jobs: 'googleJobs', job_alert_emails: 'jobAlertEmails',
  descriptions: 'descriptions', places: 'places', title_sorting: 'titleSorting', scoring: 'scoring', job_facts: 'jobFacts', kits: 'kits', employer_names: 'employerNames'};   // = time_budget.STAGES (resume.STEPS), pinned by its test
const READS = new Set(['web_search', 'job_boards', 'employer_sites', 'free_job_apis', 'google_jobs', 'job_alert_emails', 'descriptions']);   // steps whose work left is reading, said "left to read"
const word = step => t(`nextStep.step_${WORDS[step]}`);

/** The line for `run`'s card ('' when it has none). run: {kind: 'search', live, id, startedAt, endedAt}; runs: the activity list; nextStep: {steps: [{step, left}], at}.
 * Why (review of #P3): the plan must have been made BY this run, between its start and its end: a plan saved by an earlier run, a Re-score or a Sync that is the newest
 * "search" without having planned, or a run that was stopped before its plan, never shows (no run id is kept; the clocks are the same machine's). */
export function nextStepLine(run, {runs = [], nextStep = null, now = Date.now()} = {}) {
  if (run?.kind !== 'search' || run.live || !Array.isArray(nextStep?.steps)) return '';
  const at = Date.parse(nextStep.at), began = Date.parse(run.startedAt), ended = run.endedAt ? Date.parse(run.endedAt) : now;
  if (![at, began, ended].every(Number.isFinite) || now - at > MAX_AGE_MS || at < began - SLACK_MS || at > ended + SLACK_MS) return '';
  const newest = newestSearch(runs);
  if (newest && String(newest.id) !== String(run.id)) return '';
  const [first, second] = nextStep.steps.filter(step => WORDS[step?.step]);
  if (!first) return '';
  const left = Number.isInteger(first.left) && first.left > 0 ? first.left : 0;
  const key = `${second ? 'line' : 'one'}${left ? (READS.has(first.step) ? 'Read' : 'Left') : ''}`;
  return t(`nextStep.${key}`, {first: word(first.step), second: second ? word(second.step) : '', left: displayNumber(left)});
}
