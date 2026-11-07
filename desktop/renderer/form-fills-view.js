import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// Form-fill history, without a window (pages/form-fills.js draws it): one agent run (src/stores/base.py AGENT_RUN_FIELDS + EXTRAS) as
// the list row and the detail, read from the shapes in the store spec's "Agent run shapes": fields.data = {fields, left_for_you,
// attachments, steps}; fields.timeline = a Claude session's status line. Guarded by test/unit/renderer/form-fills-view.test.js.
import {shortDay} from './date.js';

// Outcome → tone: done good, waiting for you warn, still going info, failed bad, the rest (not submitted, cancelled…) neutral.
const TONES = {Ready: 'good', Submitted: 'good', 'Needs input': 'warn', Open: 'info', Running: 'info', Failed: 'bad', Error: 'bad'};
export const outcomeTone = outcome => TONES[outcome] || 'neutral';

const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const data = run => (run?.fields?.data && typeof run.fields.data === 'object' ? run.fields.data : {});

// A session of the coding agent (the Agent column / record ats is its name: lib/session-runs.js AGENT), not an extension fill.
export const isSession = run => /^claude$/i.test(String(run?.fields?.agent || run?.ats || ''));

export function agentOf(run) {
  const agent = String(run?.fields?.agent || run?.ats || '');
  return isSession(run) ? t('helperTail.claudeSession') : /^extension$/i.test(agent) ? 'Extension' : run?.fields?.agent || t('helperTail.formFill');
}

// The list row: {title, company, agent, outcome, tone, at, minutes, fields, left}.
export function summary(run) {
  const f = run?.fields || {}, rows = data(run).fields || [];
  const outcome = run?.outcome || f.status || 'Open';
  const count = num(f.field_count) ?? (rows.length || null);
  return {title: f.job || hostOf(run?.url) || t('helperTail.form'), company: f.company || '', agent: agentOf(run), outcome, tone: outcomeTone(outcome),
    at: f.started || run?.created_at || '', minutes: num(f.minutes), fields: count,
    left: num(f.unfilled_required) ?? rows.filter(row => row.outcome !== 'filled' && row.required).length};
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// The field-by-field table: [{label, required, source, result, note, low}].
export function fieldRows(run) {
  return (data(run).fields || []).map(row => ({label: row.label || '', required: row.required === true ? 'yes' : row.required === false ? '' : '?',
    source: row.source || '—', result: row.outcome === 'filled' ? 'filled' : 'left', note: row.reason || '', low: row.confidence === 'low'}));
}

export const leftForYou = run => (data(run).left_for_you || []).filter(Boolean);
export const attachments = run => (data(run).attachments || []).filter(Boolean);

// Step timings [{step, seconds}] (extension fills), else [] (a Claude session has its timeline line instead).
export const steps = run => (data(run).steps || []).filter(step => step?.step).map(step => ({step: step.step, seconds: Math.round((Number(step.ms) || 0) / 100) / 10}));
// A Claude session's status timeline, as the steps of a walk: ["11:02:00 working", …].
export const timeline = run => String(run?.fields?.timeline || '').split('→').map(part => part.trim()).filter(Boolean);

// The learnings line(s): the record field, split on ' · ' as the extension joins them.
export const learnings = run => String(run?.learnings || '').split(' · ').map(text => text.trim()).filter(Boolean);

// A Claude session's numbers, [label, value] for the ones present.
export function sessionNumbers(run) {
  const f = run?.fields || {};
  const pairs = [[t('helperTail.working'), f.working_min, ' min'], [t('helperTail.waitingYou'), f.waiting_min, ' min'], [t('helperTail.timesAsked'), f.times_asked, ''],
    [t('helperTail.replyMedian'), f.reply_median_s, ' s'], [t('helperTail.readyDecided'), f.ready_to_decided_min, ' min'], [t('helperTail.turns'), f.turns, ''],
    [t('helperTail.toolCalls'), f.tool_calls, '']];
  return [...pairs.filter(([, value]) => num(value) !== null).map(([label, value, unit]) => [label, unit === ' min' ? t('helperRest.minutes', {count: num(value)}) : unit === ' s' ? t('helperRest.seconds', {count: num(value)}) : String(num(value))]),
    ...(f.model ? [[t('helperRest.model'), f.model]] : [])];
}

// The detail's meta line: when, how long, billed to, why.
export function metaLine(run, {when = iso => iso} = {}) {
  const s = summary(run), f = run?.fields || {};
  return [s.at && when(s.at), s.minutes !== null && t('helperRest.minutes', {count: s.minutes}), s.fields !== null && t('helperTail.fields', {count: s.fields}), f.billed_to, f.reason]
    .filter(Boolean).join(' · ');
}

// The tab's meta line, as Weekly's ("9 Oct · Medium confidence"): how many, how many wait for you, the latest one's day;
// "2 of 3 form fills" while a filter narrows the list.
export function listLine(runs = [], shown = runs) {
  const all = runs || [], waiting = all.filter(run => summary(run).outcome === 'Needs input').length;
  const latest = all.map(run => summary(run).at).filter(Boolean).sort().at(-1);
  const count = shown.length === all.length ? t('helperTail.formFills', {count: all.length}) : t('helperRest.shownOf', {shown: shown.length, text: t('helperTail.formFills', {count: all.length})});
  return [count, waiting && t('helperTail.needsInput', {count: waiting}), latest && t('helperTail.latest', {day: shortDay(latest)})].filter(Boolean).join(' · ');
}

// The list's filter: free text over job, company, host, agent and outcome; outcome '' = all.
export function filterRuns(runs, {text = '', outcome = ''} = {}) {
  const needle = text.trim().toLowerCase();
  return (runs || []).filter(run => {
    const s = summary(run);
    return (!outcome || s.outcome === outcome) && (!needle || `${s.title} ${s.company} ${hostOf(run.url)} ${s.agent} ${s.outcome}`.toLowerCase().includes(needle));
  });
}

// A read that has not answered after `ms` becomes {error}, so a screen shows an error with Retry instead of loading forever.
/** Return a localized timeout error while preserving the original asynchronous result. */
export const withTimeout = (promise, ms) => {
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(() => resolve({error: t('helperTail.noAnswerAfter', {count: ms / 1000})}), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};
