// What the Apply to jobs dialog says about a finished batch, pure: one row per job, a counts line, and each reason said once ([ad] try 3, owner 8 Nov 2026: "bad Looking UI").
// Design: the engine's status decides a job's chip (eight statuses); the counts line has four groups (started, ready, skipped, failed); the dialog never re-judges.
// A row shows its chip and, only when the chip alone does not say why, one muted reason; a reason the whole batch shares (or the batch's own error) is said once under the counts.
import {t} from '../i18n/index.js';
import '../i18n/screens-helpers.js';
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
 * -> {rows: [{url, job: {url, title, company} as the engine gave them (what a click opens), title, company, label, tone, icon, reason, detail}], counts: [{group, count, text}], hint, note: {text, tone} | null}
 * `result` is the app's answer ({ok, error, outcomes}). `reason` is what the row shows, `detail` the engine's sentence kept as the chip's tooltip.
 * Invariants: every outcome is one row, in order; the counts add up to the rows; a reason appears once on the screen (every reason shared by several rows, and the batch's error, in one note).
 */
export function resultView(result) {
  const outcomes = result?.outcomes || [];
  const reasons = new Map();
  for (const item of outcomes) if (item.reason && !SELF_EXPLAINING.has(item.status)) reasons.set(item.reason, (reasons.get(item.reason) || 0) + 1);
  const error = result?.ok || !outcomes.length ? '' : String(result?.error || '') || t('helperFlow.applyStartFallback');   // a refusal always says something, as the dialog did before
  const shared = [...reasons].filter(([, n]) => n > 1).map(([reason]) => reason);
  const said = new Set([error, ...shared].filter(Boolean));
  const rows = outcomes.map(item => {
    const [label, tone, glyph] = STATES[item.status] || STATES.skipped;
    const own = item.reason && !SELF_EXPLAINING.has(item.status) && !said.has(item.reason) ? item.reason : '';
    return {url: item.url, job: {url: item.url, title: item.title || '', company: item.company || ''}, title: item.title || item.company || t('pagesApplyResult.job'), company: item.title ? item.company || '' : '', label: t(`pagesApplyResult.${label}`), tone, icon: glyph, reason: own, detail: item.reason || ''};
  });
  const tally = {};
  for (const item of outcomes) { const group = (STATES[item.status] || STATES.skipped)[3]; tally[group] = (tally[group] || 0) + 1; }
  const counts = COUNT_ORDER.filter(group => tally[group]).map(group => ({group, count: tally[group], text: t(`pagesApplyResult.${group}Count`, {count: tally[group]})}));
  const note = said.size ? {text: [...said].join(' '), tone: error ? 'error' : 'muted'} : null;
  // Why ([ad] code review): Chrome's answer (it carries `jobs`) says "Review every tab and submit yourself"; "Follow them in Sessions" would be wrong for tabs, so the app's own sentence is the next step there.
  const inChrome = Array.isArray(result?.jobs);
  const hint = !tally.started ? '' : inChrome ? String(result.message || '') : t('pagesApplyResult.sessionsHint');
  return {rows, counts, hint, note};
}
