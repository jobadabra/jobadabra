// The Jobs "Apply to jobs" dialog, pure: the count's bounds, the primary button's words, a mode pick and what Start sends. Guard: test/unit/renderer/apply-dialog-mode.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {dialogNeedsConfirm, modeBuilt} from './apply-settings-model.js';

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
 * the stamp of that answer goes with Start, so it belongs to this call and to no later one. -> {ok: true, mode, autoConfirmedAt} | {ok: false} (a mode not built, or a declined confirmation: the pick stays where it was).
 * Why (7 Nov 2026, owner, #3363: "We don't want to change the settings from the Apply to jobs. We should let the user explicitly go and change that in the settings"): replaces the 28 Oct rule that a card pick is saved
 * through Settings → Apply's writer, for this dialog only.
 */
export async function applyDialogPick({mode, settings, confirm, now = () => new Date()}) {
  if (!modeBuilt(mode)) return {ok: false};   // Why (28 Oct 2026, owner): a mode that does nothing yet can never be chosen
  if (!dialogNeedsConfirm(mode, settings)) return {ok: true, mode, autoConfirmedAt: ''};
  return await confirm() ? {ok: true, mode, autoConfirmedAt: now().toISOString()} : {ok: false};
}

/**
 * Start: a valid count goes to the main process with the dialog's pick (and its Full-automation confirmation), which runs the batch in that mode (lib/apply-handlers.js).
 * Why (7 Nov 2026, #3363, code review): `chosen` is whether Settings → Apply was ever chosen. When not, the first-choice gate holds this call and replays it with the SAME arguments after the person's choice there, so a pick sent now would override what they just chose in the gate: it is not sent and the batch follows the gate's choice.
 */
export async function applyDialogStart({count, pick = '', autoConfirmedAt = '', chosen = false, cancelled = false, start}) {
  if (cancelled) return {cancelled: true};
  const n = validCount(count);
  if (!n) return {ok: false, error: t('helperFlow.applyCountBounds')};
  try { return await start({n, mode: 'settings', ...(pick && chosen ? {pick} : {}), ...(autoConfirmedAt && chosen ? {autoConfirmedAt} : {})}); } catch (error) {
    // Why (2026-10-28, owner screenshot): a rejected call arrives as "Error invoking remote method 'apply': Error: <reason>"; the person gets the reason and what to do, not Electron's wrapper.
    const reason = String(error?.message || '').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '').trim();
    return {ok: false, error: t('helperFlow.applyStartFailed', {reason: `${reason || t('helperFlow.somethingWrong')}${reason.endsWith('.') || !reason ? '' : '.'}`})};
  }
}

/**
 * What the dialog does with a finished start: fully started batches close to the Sessions toast; batches with attempted-job outcomes stay open with rows and an optional browser offer.
 * -> {close: true, toast: {title, body, target, tone}} | {close: false, error, outcomes?, browserOffer?}
 */
export function applyDialogOutcome(result) {
  // Why (7 Nov 2026, #3424): a fully-started batch uses the existing Sessions toast; inline inspection is for skipped or failed jobs.
  const toast = {title: t('helperFlow.applyingStarted'), body: result?.message, target: {view: 'sessions'}, tone: 'good'};
  if (result?.ok && result.outcomes?.length && result.outcomes.every(item => item.status === 'started')) return {close: true, toast};
  if (result?.outcomes?.length) return {close: false, error: result.ok ? result.message : result.error || t('helperFlow.applyStartFallback'), outcomes: result.outcomes, ...(result.code === 'BACKGROUND_BROWSER_MISSING' ? {browserOffer: true} : {})};
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
