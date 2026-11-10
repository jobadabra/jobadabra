// The one place that turns a broker's raw failure reason into a plain cause with an icon, and the cause counts of a run into the Telegram alert the owner reads.
//   causeOf('broker: codex-failed:null [killed after 100 s: codex did not finish]') -> {key: 'timeout', icon: '⏱', label: 'The AI took too long (over 100 s)'}
//   failureAlert({jobs, summaries, notes, run}) -> alertHtml payload (headline, bar, "Why" rows, "Open the run")
// Why (6 Nov 2026, owner on an alert full of raw JSON: "this is not very readable", "make it human readable", "Visually attractive"; picked "Headline + why"): the alert printed the broker's own
// words (codex-failed:1 {...Invalid schema for response_format...}). Raw detail stays in the run log (the ::warning lines); the message carries a cause the owner can act on, and an unknown reason
// is the plain "The AI service failed", never the raw text. Counts are the relay's real per-cause counts (broker-relay-serve.mjs), never estimated.
// Job: report health
import {card, bar as cardBar} from './tg-card.mjs';
import {reasonOf} from './broker-reason.mjs';

const UNKNOWN = {key: 'failed', icon: '⚠️', label: 'The AI service failed'};
// First match wins. Money is named only on the broker's `budget:`, a counted neuron cap or a provider's credit words, never on the bare word "capped" (a folder name, an old status): a8 rule, lib/broker-reason.mjs reasonOf. The patterns are the broker's and Codex's own failure words, not a site's or a model's.
const CAUSES = [
  [/budget:|credit balance|insufficient[_ ]quota|exceeded your current quota|usage limit|\d+ of \d+ neurons/i, (_, text) => ({key: 'allowance', icon: '💳', label: reasonOf(text)?.row || 'The AI budget is used up'})],
  [/killed after (\d+) s|did not finish|timed? ?out/i, match => ({key: 'timeout', icon: '⏱', label: `The AI took too long${match[1] ? ` (over ${match[1]} s)` : ''}`})],
  [/no answer from the broker|cut off|fetch failed|ECONNRESET|UND_ERR|socket|unreachable|no run token/i, () => ({key: 'connection', icon: '📡', label: 'The connection to the AI service dropped'})],
  // Status codes count only as a status ("HTTP 400", "status 401", "broker: 429", a reason that starts with one), never as digits inside other words ("fetch failed after 401 s").
  [/invalid schema|response_format|invalid_request|(?:\bHTTP|\bstatus|broker:)\s*400\b|^\s*400\b/i, () => ({key: 'request', icon: '🧩', label: 'Our request was refused (a bug on our side)'})],
  [/login-lost|no-token|invalid x-api-key|unauthori[sz]ed|(?:\bHTTP|\bstatus|broker:)\s*40[13]\b|^\s*40[13]\b/i, () => ({key: 'login', icon: '🔑', label: 'The AI service did not accept our login'})],
  [/rate.?limit|too many requests|(?:\bHTTP|\bstatus|broker:)\s*429\b|^\s*429\b/i, () => ({key: 'rate', icon: '🚦', label: 'The AI service asked us to slow down'})],
];

/** The plain cause of a raw failure reason: {key, icon, label}. Anything unrecognised (or empty) is the generic "The AI service failed", never the raw text. */
export function causeOf(reason) {
  const text = String(reason ?? '');
  for (const [pattern, make] of CAUSES) {
    const match = text.match(pattern);
    if (match) return make(match, text);
  }
  return {...UNKNOWN};
}

/** Adds one failed call to a causes tally {key: {icon, label, count}}: the relay calls it once per refused call, so the counts are real. */
export function tally(causes, reason) {
  const {key, icon, label} = causeOf(reason);
  (causes[key] ||= {icon, label, count: 0}).count++;
  return causes;
}

/** A tally as the list the note keeps: [{key, icon, label, count}], most frequent first. */
export const causeList = causes => Object.entries(causes || {}).map(([key, one]) => ({key, ...one})).sort((a, b) => b.count - a.count);

/** Ten blocks (lib/tg-card.mjs bar): filled for the calls that worked, empty for the rest. */
export const bar = cardBar;

const named = job => { const text = String(job || '').replace(/[-_]+/g, ' ').trim(); return text ? text[0].toUpperCase() + text.slice(1) : ''; };

/**
 * The alert for failed AI calls. Takes {jobs: [job names], summaries: [{calls, ok, failed, causes: [{key, icon, label, count}]}] or null, notes: [raw notes], run: url, workflow}.
 * With a summary for every note: "Central scout: 3 of 40 AI calls failed", a bar and a count per cause. Without (an older or other producer): no numbers, one row per note's cause.
 */
export function failureAlert({jobs = [], summaries = null, notes = [], run = '', workflow = 'CI'}) {
  const names = [...new Set(jobs.map(named).filter(Boolean))];
  const name = names.length === 1 ? names[0] : workflow;
  const sums = summaries && summaries.length ? summaries : null;
  const rows = new Map();
  let title = `${name}: AI calls failed`;
  if (sums) {
    const calls = sums.reduce((n, one) => n + one.calls, 0), failed = sums.reduce((n, one) => n + one.failed, 0);
    for (const one of sums) for (const cause of one.causes) rows.set(cause.key, {...cause, count: (rows.get(cause.key)?.count || 0) + cause.count});
    title = `${name}: ${failed} of ${calls} AI calls failed`;
  } else {
    for (const note of notes) { const {key, icon, label} = causeOf(note); rows.set(key, {key, icon, label, count: 0}); }
  }
  const why = [...rows.values()].sort((a, b) => b.count - a.count).map(one => ({icon: one.icon, count: sums ? one.count : undefined, text: one.label}));
  const counts = sums ? {done: sums.reduce((n, one) => n + one.ok, 0), total: sums.reduce((n, one) => n + one.calls, 0), doneWord: 'worked', restWord: 'failed'} : null;
  return card({level: 'orange', headline: title, bar: counts, why, verdict: {ok: true, text: 'Nothing is lost: those jobs are judged on a later run.'}, link: run ? {text: 'Open the run', url: run} : null});
}
