// The Find jobs night check's one Telegram card (finish-line G6): a source lost, a floor broken or the night not run, told once when it starts, and one "back" when it clears.
// Job: report health
// Why (10 Nov 2026, owner: "If a source is getting lost · We should have red CI · We should have alerts · on the Engineering channel"; sa's design): the causes come
// from tools/persona-search/lost.py (stored on the verdict as `lost`); this file only composes the card and sends it through ci-alert's send(), the one door:
// the switchboard's event `search-night` (Admin → Operations → Notifications, the Engineering bot the owner connected), else the old CI-alerts bot.
import fs from 'node:fs';
import path from 'node:path';
import {card, plural} from './lib/tg-card.mjs';
import {stateOf} from './lib/alert-events.mjs';
import {send} from './ci-alert.mjs';

export const EVENT = 'search-night';
const ICON = {gone: '📉', unread: '🚫', floor: '⬇️', 'not-run': '⏸️'};
const SOURCE = {eures: 'EURES', employer_sites: 'Employer sites', job_boards: 'Job boards', free_job_apis: 'Free job APIs', web_search: 'Web search', linkedin: 'LinkedIn', other: 'Other sources'};
const LABEL = {gone: what => `${SOURCE[what] || what}: no right job now`, unread: what => `${SOURCE[what] || what}: read no job`,
  floor: what => `${what} under its floor`, 'not-run': () => 'Not run'};

const people = list => (list || []).filter(n => n != null).map(n => `p${n}`).join(', ');
const labelOf = cause => (LABEL[cause.kind] || (what => what))(cause.what);
const ofKey = text => { const at = String(text).indexOf(':'); return {kind: String(text).slice(0, at), what: String(text).slice(at + 1)}; };
const nameOf = cause => (cause.kind === 'floor' ? cause.what : SOURCE[cause.what] || cause.what);   // what came back: a source, or a person's number

/**
 * The card for a verdict's `lost` ({causes, red, tell, back, merges}; tools/persona-search/lost.py) and the run link -> a tg-card payload, or '' when nothing changed.
 * Told on a change only (sa, 10 Nov 2026: "never the same alert every night"): `tell` = causes new since the last run, `back` = causes that cleared; the night stays red meanwhile.
 */
export function searchCard(lost, run) {
  const tell = Array.isArray(lost?.tell) ? lost.tell : [], back = Array.isArray(lost?.back) ? lost.back : [];
  if (!tell.length && !back.length) return '';
  const link = {text: 'Open the run', url: run};
  const why = [...tell.map(cause => ({icon: ICON[cause.kind] || '•', text: `${labelOf(cause)}${cause.people?.length ? ` (${people(cause.people)})` : ''}: ${cause.detail}`})),
    ...back.map(text => ({icon: '✅', text: `${nameOf(ofKey(text))}: back`}))];
  const red = tell.filter(cause => cause.red);
  if (red.length) {
    const headline = red.length === 1 ? `Find jobs · ${labelOf(red[0])}` : `Find jobs · ${red.length} causes red`;
    return card({level: 'red', headline, why, facts: (lost.merges || []).slice(0, 2).map(line => `🔀 Since the last green: ${line}`),
      verdict: {ok: false, text: 'The night stays red until it reads again; this is told once, the next message says it is back.'}, link});
  }
  if (tell.length) {
    return card({level: 'grey', headline: `Find jobs · ${plural(tell[0].people?.length || 0, 'person', 'persons')} not run`, why,
      verdict: {ok: false, text: 'Start it again by hand: gh workflow run search-personas.yml'}, link});
  }
  const still = (lost.causes || []).filter(cause => cause.red).length;
  return card({level: 'green', headline: `Find jobs · ${back.length === 1 ? `${nameOf(ofKey(back[0]))} back` : `${back.length} causes back`}`, why,
    verdict: still ? {ok: false, text: `Still red: ${plural(still, 'other cause')}.`} : {ok: true, text: 'Every source reads again and every number holds its floor.'}, link});
}

/** The switchboard's `state` and `level` for what this card tells: one key per told or cleared cause + the UTC day; a red or not-run told is a problem, a back alone ok. */
export function sendOptions(lost, now = new Date()) {
  const tell = Array.isArray(lost?.tell) ? lost.tell : [], back = Array.isArray(lost?.back) ? lost.back : [];
  return {event: EVENT, ...stateOf(tell.length ? 'failure' : 'success', {jobs: [...tell.map(cause => `${cause.kind}:${cause.what}`), ...back.map(text => `back:${text}`)], now})};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const verdict = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const run = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  console.log(await send(searchCard(verdict.lost, run), process.env, fetch, sendOptions(verdict.lost)));
}
