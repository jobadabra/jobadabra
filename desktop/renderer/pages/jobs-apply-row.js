// One job's Apply from its Jobs row: the main button's start and the ⋯ menu's per-job modes, each through Apply readiness first (renderer/apply-readiness-read.js).
// Invariants: a pick in the ⋯ menu is this job's only and never writes Settings (the main process runs it under the pick's own Full automation confirmation, lib/apply-handlers.js applyOne);
// Full automation asks its one confirmation here unless Settings already holds it (applyDialogPick, the Jobs dialog's own rule); nothing starts before the job's readiness answered.
// Why (8 Nov 2026, owner, R2: "Yes, as drawn" on the ⋯ menu's modes; "every Apply goes through Apply readiness"): moved out of jobs-render.js (near its size limit) with the menu's modes added.
import {t} from '../../i18n/index.js';
import {kitThroughStep} from '../apply-readiness-read.js';
import {applyDialogOutcome, applyDialogPick} from '../apply-dialog-model.js';
import {applyOf, MODES, modeBuilt} from '../apply-settings-model.js';
import {jobPlace} from '../targets.js';
import {pageKey} from './jobs-state.js';
import {shared} from './shared.js';

// The menu's order: the hidden browser first (the mode most people pick), then Chrome, then Full automation (owner's picture, 8 Nov 2026).
const MENU_ORDER = ['fill', 'check', 'auto'];
// The page functions a row's Apply needs, handed in by wireRowApply: importing them (pages/jobs.js, apply-settings.js, startup.js) closed import cycles (arch check, #3630).
// Unwired, a Full automation pick is refused, never started unconfirmed.
let wired = {startedApplying: () => {}, confirm: async () => false, toastMessage: () => {}, sayRefused: () => false};
const STARTING = new Set();   // job links whose Apply (the row's button, a ⋯ menu pick) is getting ready or starting: the rows are redrawn often, so this outlives one row

/**
 * Hands in what a row's Apply needs from the pages: `startedApplying(job)` marks the row, `confirm()` is Full automation's one confirmation, `toastMessage` and `sayRefused` are
 * pages/startup.js's pop-ups. Called once by pages/jobs-apply.js.
 */
export function wireRowApply({startedApplying, confirm, toastMessage, sayRefused}) { wired = {startedApplying, confirm, toastMessage, sayRefused}; }

/**
 * The row's Apply for one job. `rerender` redraws the Jobs list. -> {start(button, {pick, ready, track}), modeItems()}: `start` gets the job ready through Apply readiness (unless `ready`: the
 * caller just did), then starts it in the saved mode or the `pick` ({mode, autoConfirmedAt, linkedinConfirmedAt}); `track('local'|'failed'|null)` tells a kitless row that the draft runs, was refused or is done;
 * `modeItems` are the ⋯ menu's rows, under one heading, the saved mode marked current.
 */
export function createRowApply(job, {rerender}) {
  const details = {title: job.title, company: job.company, location: job.location, workMode: job.work_mode};
  // Same words as the batch's toast (applyDialogOutcome); a refusal (browser missing, not confirmed) is said, never "No link".
  const sayChecking = () => wired.toastMessage(t('pagesJobs.checkingReadiness'), [job.title, job.company].filter(Boolean).join(' · '), jobPlace(job), 'info');
  const queuedInBackground = result => {
    const outcome = applyDialogOutcome(result);
    if (!outcome.close) { wired.toastMessage('Apply did not start', outcome.error, jobPlace(job), 'warn'); return; }
    wired.startedApplying(job); rerender();
    wired.toastMessage(outcome.toast.title, outcome.toast.body, outcome.toast.target, outcome.toast.tone);
  };
  /** Apply readiness for this job (its kit when missing, then its form check), the button busy meanwhile. -> true when the job may start. */
  const getReady = async (button, track) => {
    const label = button?.textContent;
    track?.('local');
    if (button) { button.disabled = true; button.classList.add('busy', 'state-busy'); button.textContent = t('pagesJobs.checkingReadiness'); }
    const ready = await kitThroughStep(window.pilot, job);
    if (button) { button.disabled = false; button.classList.remove('busy', 'state-busy'); button.textContent = label; }
    if (ready.ok) { job.kit = true; for (const item of shared.allJobs || []) if (item.code === job.code) item.kit = true; track?.(null); return true; }
    track?.('failed');
    wired.sayRefused(t('pagesControlStatus.applyNotStarted'), ready, {place: jobPlace(job)});   // a refusal says why (renderer/refusal.js); a draft that failed is notified by main
    return false;
  };
  // Chrome opens the job's form and the extension fills it at once from the kit; a hidden-browser mode queues it instead.
  // Every way in (the row's Apply, a ⋯ menu pick, the kitless path) takes the job's one lock before its first await: a second press while one gets ready starts nothing (Gitar on #3630).
  // Why (#3638, 12 Nov 2026): the kitless row's press used to run readiness (which drafts the kit) before taking this lock, so a ⋯ pick still running drafted it a second time; it now comes in here with `track`.
  const start = async (button, {pick = null, ready = false, track = null} = {}) => {
    if (STARTING.has(job.url)) { sayChecking(); return; }
    STARTING.add(job.url);
    try { await startNow(button, {pick, ready, track}); } finally { STARTING.delete(job.url); }
  };
  const startNow = async (button, {pick, ready, track}) => {
    if (!ready && !(await getReady(button, track))) return;
    const result = await window.pilot.applyOne(job.url, details, pick);
    if (result.background) return queuedInBackground(result);   // a hidden-browser mode queued the job: no tab opened, so the row does not read "Opened"
    if (result.ok) { shared.openedInChrome.add(pageKey(job.url)); wired.startedApplying(job); rerender(); if (result.extensionNote) wired.toastMessage(t('pagesFinalCopy.olderExtension'), result.extensionNote, jobPlace(job), 'warn'); } else if (result.needsExtension || result.cancelled) { /* the install dialog is open (extension-needed.js), or Not now in the first-Apply dialog */ }
    else if (wired.sayRefused(t('pagesControlStatus.applyNotStarted'), result, {place: jobPlace(job)})) { /* why, in a pop-up (no AI credit, trial over, no store): never "No link" */ } else if (button) button.textContent = t('pagesJobs.noLink');
    else wired.toastMessage(t('pagesJobs.openJobFailed'), t('pagesJobs.hasNoLink'), jobPlace(job), 'bad');
  };
  /**
   * A ⋯ menu pick: Full automation's confirmation first (none when Settings holds it), then this job only, in that mode. The menu has closed, so a pop-up says the check runs,
   * and a second pick on the same job while it runs starts nothing (code review of R2, 8 Nov 2026: a silent 20-40 s, and a second pick drafted the kit and queued the job twice).
   */
  const startIn = async mode => {
    if (STARTING.has(job.url)) { sayChecking(); return; }
    const picked = await applyDialogPick({mode, settings: shared.state?.settings, confirm: wired.confirm});   // the confirmation is a modal dialog: no other press reaches the row meanwhile
    if (!picked.ok) return;
    if (!STARTING.has(job.url)) sayChecking();
    await start(null, {pick: {mode: picked.mode, autoConfirmedAt: picked.autoConfirmedAt, linkedinConfirmedAt: picked.linkedinConfirmedAt}});
  };
  const modeItems = () => {
    const saved = applyOf(shared.state?.settings).mode;
    const rows = MENU_ORDER.map(id => MODES.find(mode => mode.id === id)).filter(mode => mode && modeBuilt(mode.id))
      .map(mode => ({tile: mode.icon, label: mode.title, detail: mode.text, current: mode.id === saved, run: () => startIn(mode.id)}));
    return rows.length ? [{heading: t('pagesJobs.applyThisJobWith')}, ...rows, '-'] : [];   // the heading's own rule separates it from the rows above
  };
  return {start, modeItems};
}
