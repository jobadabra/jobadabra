// The job ⋯ menu's one apply-readiness item, which follows the job's stored check: "Check apply readiness" checks only this job, like the top button does for all; "Fix what's missing" opens
// the drawer on Apply readiness. Why: renderer/apply-readiness-view.js.
import {menuItemOf} from '../apply-readiness-view.js';
import {nextPart} from '../job-drawer/drawer-actions.js';
import {checkJob, readOf} from './jobs-triage.js';

/** The menu entry for one job: {icon, label, run}; its label and action come from menuItemOf(the stored check). `openPanel(job, tab)` opens the drawer (pages/job-panel.js openJobPanel, passed in so this module imports no page). */
export function readinessItem(job, openPanel) {
  const {action, label} = menuItemOf(readOf(job.url));
  if (action === 'fix') return {icon: 'target', label, run: () => { nextPart.set(job.url, 'readiness'); openPanel(job, 'application'); }};
  return {icon: 'search', label, run: () => checkJob(job)};
}
