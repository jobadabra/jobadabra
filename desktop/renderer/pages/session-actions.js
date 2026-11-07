// Session actions: remove, close, cancel, skip, restart, resume and pause one application session.
// Moved out of sessions.js (which re-exports them). Guarded by test/unit/main/terminals.test.js and test/unit/main/form-tab-closed.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {isLive} from '../session-state.js';
import {shared} from './shared.js';
import {jobsChanged, renderJobs, startedApplying} from './jobs.js';
import {openSession} from './session-log.js';
import {toastMessage} from './startup.js';
import {logChoice, refreshSessions, sessionJob} from './sessions.js';  // cycle by design: used inside functions only
import {storeName} from '../store-words.js';
import {NO_PLACE, sessionPlace} from '../targets.js';

// Removing a session whose job is still Applying asks whether it was submitted (Applied, or back to Kit ready), so
// a job never stays stuck as Applying; any other job's session just goes.
// After each ending (Close, Cancel, Skip) the job list is read again (jobsChanged): its row is patched only when the session's address found it.
export async function removeSession(item) {
  if (sessionJob(item).stage === 'Applying') {
    const result = await window.pilot.sessionFinish(item.id);
    if (result?.cancelled) return;
    if (!result?.ok) { toastMessage(t('pagesSessionStates.notRemoved'), result?.error || `${storeName()} could not be updated. Try again.`, sessionPlace(item), 'bad'); return; }
    jobsChanged(sessionJob(item), result.submitted ? {stage: 'Applied', status: 'applied'} : {stage: 'Kit ready', status: 'saved'});
  } else await window.pilot.sessionRemove(item.id);
  if (shared.openSessionId === item.id) shared.openSessionId = null;
  await refreshSessions();
  if (!document.querySelector('.view[data-view="jobs"]').hidden) renderJobs();
}
// Close: Claude stops (if it runs), then the session goes; a job still Applying asks "Did you submit?" first.
export async function closeSession(item) {
  if (isLive(item)) await window.pilot.sessionStop(item.id);
  await removeSession(item);
}
// Cancel: Claude stops, the form tab closes, the job goes back to Kit ready, the session goes (asked once).
export async function cancelSession(item) {
  const result = await window.pilot.sessionCancel(item.id);
  if (result?.cancelled) return;
  if (!result?.ok) { toastMessage(t('pagesSessionStates.notCancelled'), result?.error || t('pagesCommon.tryAgain'), sessionPlace(item), 'bad'); await refreshSessions(); return; }
  const job = sessionJob(item);
  jobsChanged(job, job.stage === 'Applying' ? {stage: 'Kit ready', status: 'saved'} : {});
  // Why (2026-11-05, owner): cancellation confirms only the result, without internal stages or missing-tab instructions.
  toastMessage(t('pagesSessionStates.cancelled'), '', NO_PLACE.done, 'info');
  if (shared.openSessionId === item.id) shared.openSessionId = null;
  await refreshSessions();
  if (!document.querySelector('.view[data-view="jobs"]').hidden) renderJobs();
}
// Skip this role: give up. Claude stops, the form tab closes, the job is dismissed, the session goes (no question).
export async function skipSession(item) {
  const result = await window.pilot.sessionSkip(item.id);
  if (!result?.ok) { toastMessage(t('pagesSessionStates.notSkipped'), result?.error || t('pagesCommon.tryAgain'), sessionPlace(item), 'bad'); await refreshSessions(); return; }
  jobsChanged(sessionJob(item), {stage: 'Dismissed', status: 'dismissed'});
  if (!result.closed) toastMessage(t('pagesSessionStates.roleSkipped'), t('pagesSessionStates.skipMissingTab'), NO_PLACE.outside, 'warn');
  if (shared.openSessionId === item.id) shared.openSessionId = null;
  await refreshSessions();
  if (!document.querySelector('.view[data-view="jobs"]').hidden) renderJobs();
}
// Start again: this session closes and a new one starts on the same job (asked once, in a dialog).
export async function restartSession(item) {
  const result = await window.pilot.sessionRestart(item.id);
  if (result?.cancelled || result?.needsExtension) return;   // needsExtension: the install dialog is open (extension-needed.js)
  if (!result?.ok) { toastMessage(t('pagesSessionStates.notRestarted'), result?.error || t('pagesCommon.tryAgain'), sessionPlace(item), 'bad'); await refreshSessions(); return; }
  startedApplying(sessionJob(item));
  await refreshSessions();
  if (result.session?.id) openSession(result.session.id);
}
// Claude again, in this session's conversation (the app was closed, or the session stopped). The log opens to show it.
export async function resumeSession(item) {
  const result = await window.pilot.sessionResume(item.id);
  if (result?.cancelled) return;   // Not now in the first-Apply dialog
  if (!result?.ok) { toastMessage(t('pagesSessionStates.notResumed'), result?.error || t('pagesSessionStates.claudeFailed'), sessionPlace(item), 'bad'); return; }
  logChoice[item.id] = true;
  shared.termShownFor = null;
  await refreshSessions();
}
export function pauseSession() { if (shared.openSessionId) window.pilot.sessionWrite(shared.openSessionId, '\x1b'); }  // Esc interrupts Claude
