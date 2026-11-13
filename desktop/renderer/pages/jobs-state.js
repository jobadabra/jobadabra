// Jobs page, shared state: one jobsState object (a value reassigned later stays ONE binding for every piece) and the link keys. Guarded by: the Jobs tests (count-flash, live-count, activity-selection-kept).
import {DEFAULT_FILTERS} from '../jobs-filters.js';

// Apply with Claude: offered (and recommended) when Claude Code is installed and Notion is connected.
export const jobsState = {
  jobsLoading: false,  // the first load from Notion is under way: the list keeps its spinner
  statFilter: null,  // the counter clicked above the list: 'applied', 'waiting', 'interviews', 'closed', 'high', 'companies', 'stuck' or null (Inbound picks the menu's filter)
  claudeReady: false,
  benchmarkText: {},   // url -> the board's typical reply line (lib/benchmarks.js), refreshed with the jobs list
  lastJobsData: null,   // the list as last loaded: a deleted job is recounted from it at once
  jobsRead: false,   // the first read of the list ended (read or failed): the Find jobs card's "empty" waits for it
  filters: [...DEFAULT_FILTERS],   // the ticked filters (the app starts on All matches: jobs-filters.js DEFAULT_FILTERS) of the one Show menu (jobs-filters.js): a job shows when any of them holds it
  mode: 'list',   // 'list' or 'board' (pages/jobs-views.js, remembered on this computer)
};
// Why (2 Nov 2026, a8; apply e2e runs 41412195017, 41447682988): the list opens on the kept copy and the fresh read replaces it 0.3-1.8 s later; a Start pressed
// in between picked from the kept copy (the job just saved at fit 90 was still "applied" at 80 there) and read the wrong job. One owner (loadJobs) marks the read
// under way and lands it; an action that picks jobs to work on waits for it (renderer/apply-triage-pick.js pickWhenFresh).
let listRead = Promise.resolve();
/** Marks the fresh read of the list as under way (pages/jobs.js loadJobs). Returns `landed()`, which ends the wait whether the read worked or failed; a later call replaces the wait. */
export function startListRead() {
  let landed;
  listRead = new Promise(resolve => { landed = resolve; });
  return () => landed();
}
/** Resolves once the fresh read of the list under way has landed; at once when none is. Never rejects. */
export const listReady = () => listRead;
export const MORE = 500;   // rows each "Show more" adds
export const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');
// The whole link, #part included: recruiter leads differ only there (linkedin.com/messaging/#jp-…, a Gmail thread).
// Exported: the activity panel counts how many of a run's matches this list really holds (pages/activity.js).
export const fullKey = url => String(url || '').trim().replace(/\/$/, '');
