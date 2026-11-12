// Which switchboard event (an id of jobadabra-web shared/notify-registry.js) a CI workflow's ci-alert.mjs call is, and the `state` / `level` its "when" modes need.
// Job: report health
// Why (5 Nov 2026, owner: "control easily on what I want to get alerted or not"; nt 3/4c): one table, so a workflow step that runs the ci-alert CLI needs no event name of its own.
// A workflow that is not here keeps the old CI-alerts bot only (nothing is lost): add it with its registry event.
import path from 'node:path';

export const WORKFLOW_EVENTS = {
  'e2e.yml': 'main-red',
  'journeys.yml': 'journey-failing',
  'harness-daily.yml': 'harness-daily',
  'replay-refill.yml': 'replay-refill',
  'site-replays.yml': 'replay-drift',
  'search-personas.yml': 'search-night',   // sent by desktop/e2e/search-alert.mjs with this event; registered in jobadabra-web shared/notify-registry.js (#529)
  'search-profiles.yml': 'search-profiles',   // by hand: the 30 Trello profiles' run, sent by desktop/e2e/tell-owner.mjs with this event; registered in jobadabra-web shared/notify-registry.js (#602)
};

/** The event of the workflow file that runs this step (GITHUB_WORKFLOW_REF), or '' for one with no registry alert yet. */
export const eventOfWorkflow = (env = process.env) => WORKFLOW_EVENTS[path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0])] || '';

/**
 * What the switchboard's "when" modes read: `level` (a failure is a problem, a recovery an all-clear) and, for a failure, `state` = the red steps (or failed jobs) + the UTC day.
 * Why (10 Nov 2026, owner's shot of 8 Nov: "apply · red on main" sent at 18:25 and 23:01 for two commits with the same failed step): state was left out (5 Nov, code review of 3/4c) because a green run
 * after a merge sends nothing, so "green" is never recorded and a later identical red would be held for good. Adding the day bounds that: the same red set is told once per UTC day (a "still red"
 * reminder), a different set or the next day tells again, and a fix then a regression the same day is the only thing held.
 * A recovery carries no state: it is its own message each time.
 */
export const stateOf = (status, {causes = [], jobs = [], now = new Date()} = {}) => {
  if (status !== 'failure') return {level: 'ok'};
  const keys = (causes.length ? causes.map(cause => `${cause.suite} · ${cause.step}`) : jobs.map(job => job.name || job)).sort().join('|');
  let hash = 5381;
  for (const char of keys) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return {level: 'problem', ...(keys ? {state: `red:${hash.toString(36)}:${now.toISOString().slice(0, 10)}`} : {})};
};
