// The Jobs "Apply to jobs" dialog, pure: the count's bounds, the primary button's words, a mode pick and what Start sends. Guard: test/unit/renderer/apply-dialog-mode.test.js.
import '../i18n/screens-helpers.js';
import '../i18n/screens-pages.js';
import {t} from '../i18n/index.js';
import {dialogNeedsConfirm, easyApplyOn, modeBuilt} from './apply-settings-model.js';
import {GROUPS, splitBatch, urlsOf} from './apply-split.js';
import {chipOf} from './apply-triage-pick.js';

/** The count as a whole number of jobs from 1 to 10, or null for anything else (empty, 0, 11, 1.5). */
export function validCount(value) {
  const n = value === '' || value == null ? NaN : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/** The primary button: "Apply to 3 jobs" (owner, 28 Oct 2026: the dialog applies to jobs; it is not a settings editor). */
export function applyButtonLabel(count) {
  const n = validCount(count);
  return n ? t('helperFlow.applyCount', {count: n}) : t('helperFlow.applyJobs');
}

/**
 * A card pick in Apply to jobs: THIS batch's mode, never saved (Settings → Apply is the person's own default, changed only there). Full automation asks its confirmation first (`confirm` resolves true only on its button);
 * the stamp of that answer goes with Start, so it belongs to this call and to no later one; with Easy Apply on it shows the LinkedIn line and its yes is also `linkedinConfirmedAt` (plan 4b-1).
 * -> {ok: true, mode, autoConfirmedAt, linkedinConfirmedAt} | {ok: false} (a mode not built, or a declined confirmation: the pick stays where it was).
 * Why (7 Nov 2026, owner, #3363: "We don't want to change the settings from the Apply to jobs. We should let the user explicitly go and change that in the settings"): replaces the 28 Oct rule that a card pick is saved
 * through Settings → Apply's writer, for this dialog only.
 */
export async function applyDialogPick({mode, settings, confirm, now = () => new Date()}) {
  if (!modeBuilt(mode)) return {ok: false};   // Why (28 Oct 2026, owner): a mode that does nothing yet can never be chosen
  if (!dialogNeedsConfirm(mode, settings)) return {ok: true, mode, autoConfirmedAt: '', linkedinConfirmedAt: ''};
  const linkedin = easyApplyOn(settings);
  if (!await confirm({linkedin})) return {ok: false};
  const at = now().toISOString();
  return {ok: true, mode, autoConfirmedAt: at, linkedinConfirmedAt: linkedin ? at : ''};
}

/**
 * Start: a valid count goes to the main process with the dialog's pick (and its Full-automation confirmation), which runs the batch in that mode (lib/apply-handlers.js).
 * Why (7 Nov 2026, #3363, code review): `chosen` is whether Settings → Apply was ever chosen. When not, the first-choice gate holds this call and replays it with the SAME arguments after the person's choice there, so a pick sent now would override what they just chose in the gate: it is not sent and the batch follows the gate's choice.
 */
export async function applyDialogStart({count, pick = '', autoConfirmedAt = '', linkedinConfirmedAt = '', chosen = false, cancelled = false, start}) {
  if (cancelled) return {cancelled: true};
  const n = validCount(count);
  if (!n) return {ok: false, error: t('helperFlow.applyCountBounds')};
  // Why (8 Nov 2026, [fa] 2/2; 14 Nov 2026, plan 4b-1): `checkFirst` asks the app to hold a Full automation batch for its form check and the person's answer to the split (pages/apply-check.js); other modes ignore it. The LinkedIn yes goes with the pick, under the same `chosen` rule.
  try { return await start({n, mode: 'settings', checkFirst: true, ...(pick && chosen ? {pick} : {}), ...(autoConfirmedAt && chosen ? {autoConfirmedAt} : {}), ...(linkedinConfirmedAt && chosen ? {linkedinConfirmedAt} : {})}); } catch (error) {
    // Why (2026-10-28, owner screenshot): a rejected call arrives as "Error invoking remote method 'apply': Error: <reason>"; the person gets the reason and what to do, not Electron's wrapper.
    const reason = String(error?.message || '').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '').trim();
    return {ok: false, error: t('helperFlow.applyStartFailed', {reason: `${reason || t('helperFlow.somethingWrong')}${reason.endsWith('.') || !reason ? '' : '.'}`})};
  }
}

/**
 * What the dialog does with a finished start: fully started batches close to the Sessions toast; batches with attempted-job outcomes stay open with rows and an optional browser offer.
 * -> {close: true, toast: {title, body, target, tone}} | {close: false, error?, outcomes?, browserOffer?}; with outcomes the words come from resultView (apply-result-model.js), not `error`
 */
export function applyDialogOutcome(result) {
  // Why (7 Nov 2026, #3424): a fully-started batch uses the existing Sessions toast; inline inspection is for skipped or failed jobs.
  const toast = {title: t('helperFlow.applyingStarted'), body: result?.message, target: {view: 'sessions'}, tone: 'good'};
  if (result?.ok && result.outcomes?.length && result.outcomes.every(item => item.status === 'started')) return {close: true, toast};
  if (result?.outcomes?.length) return {close: false, outcomes: result.outcomes, ...(result.code === 'BACKGROUND_BROWSER_MISSING' ? {browserOffer: true} : {})};
  if (result?.ok) return {close: true, toast};
  return {close: false, error: result?.error || t('helperFlow.applyStartFallback'), ...(result?.code === 'BACKGROUND_BROWSER_MISSING' ? {browserOffer: true} : {})};
}

/** One start at a time: a second press while the first batch starts is ignored; a later deliberate start is not. */
export function createApplyStartGate() {
  let starting = false;
  return {
    isStarting: () => starting,
    run: async start => {
      if (starting) return {ignored: true};   // Why (27 Oct 2026): a second click must not launch another set of Chrome tabs.
      starting = true;
      try { return await start(); }
      finally { starting = false; }
    },
  };
}

const GROUP_LOOK = {auto: ['groupAuto', 'good'], fill: ['groupFill', 'info'], check: ['groupCheck', 'warn'], none: ['groupNone', 'neutral']};
const who = job => [job.company, job.title].filter(Boolean).join(' · ') || job.url;
// A job the check could not read is "Couldn't read" with its reason; any other read is its own chip (the same words as the form-check dialog, apply-triage-pick.js).
const chipFor = (read, reason) => chipOf(!read || read.unreadable ? {unreadable: true, why: read?.why || reason} : read);

/**
 * The check panel of a held Full automation batch ([fa] 2/2, spec 2026-11-07-full-automation-check-first), pure. `check` is the app's hold answer ({plan, allowIneligible, jobs: [{url, title, company, read}]}),
 * `reads` a Map of the jobs checked so far (url -> read; a job that gave nothing maps to null; a job not checked yet is absent).
 * -> {seen, total, done, rows, groups, title, lines, autoUrls, startable, confirmLabel}: `rows` every job in order with its chip (null = not checked yet), `groups` the split's four groups from
 * splitBatch, the same function Confirm is checked with in the app, `autoUrls` the Full automation jobs Confirm sends.
 * Invariant: a job is under Full automation here only when the app's split puts it there; a job still unchecked is never counted as one.
 */
export function checkView(check, reads = new Map()) {
  const jobs = check?.jobs || [], allowIneligible = check?.allowIneligible === true;
  const shown = read => (read && allowIneligible ? {...read, eligible: true} : read);   // the batch's own eligibility choice, as the app splits it
  const rows = jobs.map(job => ({url: job.url, who: who(job), chip: reads.has(job.url) ? chipFor(shown(reads.get(job.url)), 'unreadable') : null}));
  const seen = rows.filter(row => row.chip).length;
  const split = splitBatch(jobs, url => reads.get(url) || null, {allowIneligible});
  const groups = GROUPS.map(key => ({key, title: t(`pagesApplyCheck.${GROUP_LOOK[key][0]}`), tone: GROUP_LOOK[key][1],
    rows: split[key].map(({job, reason}) => ({url: job.url, who: who(job), chip: chipFor(shown(reads.get(job.url) || null), reason)}))}));
  const count = key => split[key].length, auto = count('auto'), other = count('fill') + count('check'), none = count('none'), startable = auto + other;
  const title = auto === jobs.length ? t('pagesApplyCheck.allAuto', {count: auto}) : auto ? t('pagesApplyCheck.autoTitle', {count: auto}) : t('pagesApplyCheck.noneAuto');
  const lines = [other ? t(auto ? 'pagesApplyCheck.otherLead' : 'pagesApplyCheck.needLead', {count: other}) : '', none ? t('pagesApplyCheck.unreadLead', {count: none}) : '', startable ? t('pagesApplyCheck.nothingQueued') : t('pagesApplyCheck.nothingToApply')].filter(Boolean);
  return {seen, total: jobs.length, done: seen === jobs.length, rows, groups, title, lines, autoUrls: urlsOf(split.auto), startable, confirmLabel: t('pagesApplyCheck.confirm', {count: startable})};
}

/**
 * The dialog's answer for a held batch: Confirm's (or Cancel's) answer with the outcomes Start already had (a kit that could not be prepared, a job already open) for jobs Confirm does not name.
 * -> {cancelled: true, outcomes} | Confirm's answer with those outcomes first. Why (8 Nov 2026, [fa] 2/2 code review): the check's answer replaced Start's, so a kit that failed was never shown.
 */
export function mergeHeld(held, result) {
  const earlier = held?.outcomes || [];
  if (result?.cancelled) return {cancelled: true, outcomes: earlier};   // the list refreshes (rows may have left New), then the dialog closes
  const named = new Set((result?.outcomes || []).map(item => item.url));
  const outcomes = [...earlier.filter(item => !named.has(item.url)), ...(result?.outcomes || [])];
  return outcomes.length ? {...result, outcomes} : result;
}
