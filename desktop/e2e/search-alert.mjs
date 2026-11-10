// The Find jobs night check's one Telegram card (finish-line G6): a source lost, a floor broken or the night not run, and one "green again" when it clears.
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
const LABEL = {gone: what => `${SOURCE[what] || what}: no right job now`, unread: what => `${SOURCE[what] || what}: read no job for anyone`,
  floor: what => `${what} under its floor`, 'not-run': () => 'Not run'};

const people = list => (list || []).filter(n => n != null).map(n => `p${n}`).join(', ');

/** The card for a verdict's `lost` ({causes, red, green_again, merges}) and the run link -> a tg-card payload, or '' when there is nothing to tell. */
export function searchCard(lost, run) {
  const causes = Array.isArray(lost?.causes) ? lost.causes : [];
  const link = {text: 'Open the run', url: run};
  if (!causes.length) {
    return lost?.green_again ? card({level: 'green', headline: 'Find jobs · night check green again', verdict: {ok: true, text: 'Every source brought right jobs again and every number holds its floor.'}, link}) : '';
  }
  const red = causes.filter(cause => cause.red);
  const why = causes.map(cause => ({icon: ICON[cause.kind] || '•', text: `${(LABEL[cause.kind] || (w => w))(cause.what)}${cause.people?.length ? ` (${people(cause.people)})` : ''}: ${cause.detail}`}));
  const merges = (lost.merges || []).slice(0, 2).map(line => `🔀 Since the last green: ${line}`);
  if (!red.length) {
    const blind = causes.find(cause => cause.kind === 'not-run');
    return card({level: 'grey', headline: `Find jobs · ${plural(blind?.people?.length || 0, 'person', 'persons')} not run`, why,
      verdict: {ok: false, text: 'Start it again by hand: gh workflow run search-personas.yml'}, link});
  }
  const headline = red.length === 1 ? `Find jobs · ${(LABEL[red[0].kind] || (w => w))(red[0].what)}` : `Find jobs · ${red.length} causes red`;
  return card({level: 'red', headline, why, facts: merges, verdict: {ok: false, text: 'The night is red until each source brings right jobs again.'}, link});
}

/** The switchboard's `state` and `level` for a verdict's `lost`: one key per cause + the UTC day (a repeat the same day is held), none for green again. */
export function sendOptions(lost, now = new Date()) {
  const causes = Array.isArray(lost?.causes) ? lost.causes : [];
  return {event: EVENT, ...stateOf(causes.length ? 'failure' : 'success', {jobs: causes.map(cause => `${cause.kind}:${cause.what}`), now})};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const verdict = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const run = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  console.log(await send(searchCard(verdict.lost, run), process.env, fetch, sendOptions(verdict.lost)));
}
