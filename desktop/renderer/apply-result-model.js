// What the Apply to jobs dialog says about a finished batch, pure: one row per job, a counts line, and each reason said once ([ad] try 3, owner 8 Nov 2026: "bad Looking UI").
// Design: a job is in exactly one of five states (started, ready, skipped, failed, plus the chip's own word); the engine's status decides it, the dialog never re-judges.
// A row shows its chip and, only when the chip alone does not say why, one muted reason; a reason the whole batch shares (or the batch's own error) is said once under the counts.
import {t} from '../i18n/index.js';
import '../i18n/screens-pages.js';

/** status -> [chip label key, tone, icon, counts group]. A status the engine adds later falls back to `skipped`. */
export const STATES = {
  started: ['started', 'good', 'tick', 'started'], prepared: ['ready', 'info', 'tick', 'ready'], ineligible: ['notEligible', 'warn', 'flag', 'skipped'],
  failed: ['failed', 'bad', 'close', 'failed'], 'not-started': ['notStarted', 'warn', 'clock', 'skipped'], busy: ['alreadyOpen', 'neutral', 'info', 'skipped'],
  'already-queued': ['alreadyQueued', 'warn', 'clock', 'skipped'], skipped: ['skipped', 'warn', 'info', 'skipped'],
};
const COUNT_ORDER = ['started', 'ready', 'skipped', 'failed'];
const SELF_EXPLAINING = new Set(['started', 'prepared', 'busy']);   // the chip says it all; the engine's sentence ("This job already has an application session open.") only repeats it

/**
 * -> {rows: [{url, title, company, label, tone, icon, reason, detail}], counts: [{group, count, text}], hint, note: {text, tone} | null}
 * `result` is the app's answer ({ok, error, outcomes}). `reason` is what the row shows, `detail` the engine's sentence kept as the chip's tooltip.
 * Invariants: every outcome is one row, in order; the counts add up to the rows; a reason appears once on the screen.
 */
export function resultView(result) {
  const outcomes = result?.outcomes || [];
  const reasons = new Map();
  for (const item of outcomes) if (item.reason && !SELF_EXPLAINING.has(item.status)) reasons.set(item.reason, (reasons.get(item.reason) || 0) + 1);
  const error = result?.ok ? '' : String(result?.error || '');
  const shared = [...reasons].find(([, n]) => n > 1)?.[0] || '';
  const said = new Set([error, shared].filter(Boolean));
  const rows = outcomes.map(item => {
    const [label, tone, glyph] = STATES[item.status] || STATES.skipped;
    const own = item.reason && !SELF_EXPLAINING.has(item.status) && !said.has(item.reason) ? item.reason : '';
    return {url: item.url, title: item.title || item.company || t('pagesApplyResult.job'), company: item.title ? item.company || '' : '', label: t(`pagesApplyResult.${label}`), tone, icon: glyph, reason: own, detail: item.reason || ''};
  });
  const tally = {};
  for (const item of outcomes) { const group = (STATES[item.status] || STATES.skipped)[3]; tally[group] = (tally[group] || 0) + 1; }
  const counts = COUNT_ORDER.filter(group => tally[group]).map(group => ({group, count: tally[group], text: t(`pagesApplyResult.${group}Count`, {count: tally[group]})}));
  const note = error ? {text: error, tone: 'error'} : shared ? {text: shared, tone: 'muted'} : null;
  return {rows, counts, hint: tally.started ? t('pagesApplyResult.sessionsHint') : '', note};
}
