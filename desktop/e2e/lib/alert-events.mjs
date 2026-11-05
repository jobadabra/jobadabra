// Which switchboard event (an id of jobadabra-web shared/notify-registry.js) a CI workflow's ci-alert.mjs call is, and the `state` / `level` its "when" modes need.
// Job: report health
// Why (5 Nov 2026, owner: "control easily on what I want to get alerted or not"; nt 3/4c): one table, so a workflow that calls `node ci-alert.mjs failure|success` needs no event name of its own.
// A workflow that is not here keeps the old CI-alerts bot only (nothing is lost): add it with its registry event.
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
 * level: what "only problems" compares (a failure is a problem, a recovery is an all-clear).
 * No `state` on purpose (code review of 3/4c, 5 Nov 2026): "changes only" holds an alert whose state equals the last SENT one, but a green run after a merge sends nothing, so "green" is never recorded and
 * a later identical red would be held for good. The CLI already sends one alert per failure (isRepeat: once per commit and set of failed jobs), which is the old behaviour; `changes` therefore acts as "every
 * time" for these alerts. TODO(AI): record the green runs on the switchboard so "changes only" can hold a repeat (parked in the Backlog, 5 Nov 2026).
 */
export const stateOf = status => ({level: status === 'failure' ? 'problem' : 'ok'});
