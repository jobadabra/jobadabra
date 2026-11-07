// The split of a Full automation batch after its form check (spec 2026-11-07-full-automation-check-first): which jobs go automatic and which need another mode. Pure, shared by the app and the window.
import {modeOfRead} from './apply-triage-mode.js';

/** The batch modes a split group is queued in: Full automation, Background · you submit, In Chrome · you submit; `none` is not applied. */
export const GROUPS = Object.freeze(['auto', 'fill', 'check', 'none']);

/**
 * Puts each job of a held batch under the mode its read allows. `readOf(url)` gives the job's read, or null when it has none.
 * A job with no read, or a read that could not see the form, is `none` with its reason. `allowIneligible` is the batch's captured
 * eligibility choice: its jobs were picked with it (lib/apply.js pick), so a read's own eligible flag cannot take them out again.
 * Invariant: the split only ever lowers a job from Full automation; it never raises a job's mode.
 * @returns {{auto: Array<{job, reason}>, fill: Array<{job, reason}>, check: Array<{job, reason}>, none: Array<{job, reason}>}}
 */
export function splitBatch(jobs = [], readOf = () => null, {allowIneligible = false} = {}) {
  const split = Object.fromEntries(GROUPS.map(group => [group, []]));
  for (const job of jobs) {
    const read = readOf(job.url);
    if (!read || read.unreadable) { split.none.push({job, reason: read?.why || 'unreadable'}); continue; }
    const {mode, reason} = modeOfRead(allowIneligible ? {...read, eligible: true} : read);
    split[GROUPS.includes(mode) ? mode : 'none'].push({job, reason});
  }
  return split;
}

/** The job links in a split group, sorted, so two splits compare as lists. */
export const urlsOf = entries => entries.map(entry => entry.job.url).sort();
