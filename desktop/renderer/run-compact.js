// One run, compact (owner, 25 Oct 2026: "for all runs/tasks 2 versions: one compact which will show in app, and another one detailed which will show in
// Actions → Runs, or in the Drawer"): what the Actions banner says about a queued or finished run, for every kind, as the running banner does. Pure: the
// pill is run-status.js runPill, the one line is the Recent runs row's outcome, the next step a failure's own fix, else the kind's own (NEXT). The full report stays in
// the run panel (pages/activity-render.js). Drawn by pages/run-banner.js. Guarded by test/unit/renderer/run-compact.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {failureHead, runPill} from './run-status.js';
export {unsavedRun} from './run-status.js';

// Each kind's one next step after it worked (owner, 25 Oct 2026: "Add per-kind next steps"): the page where its result lives, or none when the run panel
// (View details) is the place to read it. `when` keeps a step to the runs that have something to see (`added`: new jobs a find saved; `made`: what an app task made, e.g. CVs). Every kind is listed: test/unit/renderer/run-compact.test.js fails on a
// new kind until it is placed here or in NO_NEXT.
export const NEXT = {
  search: {when: c => c.added > 0, label: c => t('helperState.seeNewJobs', {count: c.added}), view: 'jobs'},
  visits: {when: c => c.added > 0, label: c => t('helperState.seeNewJobs', {count: c.added}), view: 'jobs'},
  scout: {label: () => t('helperState.seeEmployers'), view: 'employers'},
  today: {label: () => t('helperState.seeMatches'), view: 'jobs'},
  kits: {label: () => t('helperState.seeApplications'), view: 'jobs'},
  tailor: {when: c => c.made !== 0, label: () => t('helperState.seeCvs'), view: 'jobs'},   // Why (#3639, 12 Nov 2026): a run with nothing to tailor ended "See the CVs in Jobs"; `made` is what the run recorded (pipeline.work), 0 = none; a run that recorded none (older rows) keeps the link
  prepare: {label: () => t('helperState.seeApplication'), view: 'jobs'},
  mail: {when: c => c.asks > 0, label: c => t('helperState.answerQuestions', {count: c.asks}), view: 'focus'},
  interview: {label: () => t('helperState.openInterviews'), view: 'interviews'},
  prep: {label: () => t('helperState.openInterviews'), view: 'interviews'},
  interviewInsight: {label: () => t('helperState.openInterviews'), view: 'interviews'},
  rejection: {label: () => t('helperState.openInterviews'), view: 'interviews'},
};
// No page to send you to: the finding itself is the result (its line says it; View details shows it whole), or the run only logged something.
export const NO_NEXT = {insight: 'its finding is the result', weekly: 'its finding is the result', add: 'it only logged an activity',
  import: 'the job it added is in Jobs already', action: 'a Telegram tap, done there'};
const ICON = {good: 'check-circle', warn: 'alert', bad: 'alert', info: 'pulse', neutral: 'pulse'};   // neutral: stopped by you, or nothing saved

// `name`: the task's name; `kind`: its activity kind; `outcome`: the Recent runs row's one line; `at` / `took`: the finish time and the duration, in words;
// `waiting` / `place`: a queued run's words (renderer/run-pick.js queueWords).
// `canRerun`: the task has a Run button on Actions (pages/activity-basics.js runButton), so Run again can press it.
// `asks`: questions this kind leaves for you (a Gmail check's "which job?": pages/focus.js pendingMailQuestions).
export function compactRun(run, {name = t('helperState.aTask'), kind = run?.kind || 'search', outcome = '', at = '', took = '', waiting = '', place = '', asks = 0, canRerun = false} = {}) {
  if (!run) return null;
  if (run.waiting) {
    return {state: 'queued', tone: 'neutral', icon: 'clock', title: name, pill: [t('helpers.queued'), 'neutral'], line: [waiting || t('helperState.waitingStart'), place].filter(Boolean).join(' · '),
      next: null, again: false, close: {label: t('helpers.cancel'), cancel: true}};
  }
  const [label, tone] = runPill({...run, kind}, {long: true});   // "No result" for a run that saved nothing (run-status.js unsavedRun), as everywhere
  const failed = failureHead({...run, kind}, name);
  const added = Number(run.new) || 0;
  const counts = {added, asks: Number(asks) || 0, made: run.made == null ? null : Number(run.made) || 0}, step = NEXT[kind];
  const worked = run.ok && !run.off && label !== t('helperState.noResult');
  // Up to three buttons once it ended (owner, 25 Oct 2026: "2-3 action buttons… View details… If an action failed we should have Run again"): the kind's next
  // step or a failure's fix, Run again for any run that did not end well, and View details (always, drawn by pages/run-banner.js).
  const next = failed?.fix?.view ? {label: failed.fix.label, view: failed.fix.view}
    : worked && step && (!step.when || step.when(counts)) ? {label: step.label(counts), view: step.view} : null;
  const again = !worked && !!canRerun;
  const said = String(outcome || '').trim();
  const waits = counts.asks && kind === 'mail' ? t('helperState.questionsForYou', {count: counts.asks}) : '';
  return {state: 'done', tone, icon: ICON[tone] || 'pulse', title: name, pill: [label, tone],
    line: [at && t('helperState.finishedAt', {time: at}), took && t('helperState.took', {duration: took}), said, waits].filter(Boolean).join(' · '), next, again, close: {label: t('helperState.dismiss'), dismiss: true}};
}
