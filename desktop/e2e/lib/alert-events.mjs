// Which switchboard event (an id of jobadabra-web shared/notify-registry.js) a CI workflow's ci-alert.mjs call is, and the `state` / `level` its "when" modes need.
// Job: report health
// Why (5 Nov 2026, owner: "control easily on what I want to get alerted or not"; nt 3/4c): one table, so a workflow that calls `node ci-alert.mjs failure|success` needs no event name of its own.
// A workflow that is not here keeps the old CI-alerts bot only (nothing is lost): add it with its registry event.
import crypto from 'node:crypto';
import path from 'node:path';

export const WORKFLOW_EVENTS = {
  'e2e.yml': 'main-red',
  'journeys.yml': 'journey-failing',
  'harness-daily.yml': 'harness-daily',
  'replay-refill.yml': 'replay-refill',
};

/** The event of the workflow file that runs this step (GITHUB_WORKFLOW_REF), or '' for one with no registry alert yet. */
export const eventOfWorkflow = (env = process.env) => WORKFLOW_EVENTS[path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0])] || '';

/**
 * state: what "changes only" compares (red with these failed jobs, or green); level: what "only problems" compares (a failure is a problem, a recovery is an all-clear).
 * A short hash of the job names: the switchboard keeps 60 characters of state, and a long list must not collide on its first 60.
 */
export function stateOf(status, jobs = []) {
  const failure = status === 'failure';
  const names = [...new Set(jobs.map(job => job.name))].sort().join('|');
  return {state: failure ? `red:${crypto.createHash('sha1').update(names).digest('hex').slice(0, 12)}` : 'green', level: failure ? 'problem' : 'ok'};
}
