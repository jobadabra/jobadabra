// What "Remove this session" asks when its job is still Applying in Notion: was it submitted?
import {t} from '../i18n/native.js';
import {criticalLabel, taskLabel} from '../i18n/quit-labels.js';
export function submitted(company) {
  return {
    message: t('native.submittedQuestion', {company: company || t('native.thisCompany')}),
    detail: t('native.submittedDetail'),
    buttons: [t('native.submittedYes'), t('native.submittedNo'), t('native.cancel')],
  };
}

// "Cancel application": what goes, asked once (the form's answers are lost with its tab).
export function cancel(company) {
  return {
    message: company ? t('native.cancelCompanyQuestion', {company}) : t('native.cancelQuestion'),
    detail: t('native.cancelDetail'),
    buttons: [t('native.cancelApplication'), t('native.keepIt')],
  };
}

// "Cancel all applications" (owner, 5 Nov 2026: in place of the header's Stop): which ones go, asked once.
export function cancelAll(sessions, label = session => session.company || t('native.application')) {
  return {
    message: sessions.length === 1 ? t('native.cancelOne') : t('native.cancelMany', {count: sessions.length}),
    detail: `${sessionLines(sessions, label).join('\n')}\n\n${t('native.cancelAllDetail')}`,
    buttons: [t('native.cancelAll'), t('native.keepThem')],
  };
}

// The words of the "you're quitting while something works" dialogs (native macOS/Windows dialogs: a title, a few
// lines, buttons). Short, one line per thing that would stop, and what happens to it.
const SHOWN = 4;

// "• N26" per session (the company: the job title is long and the list only has to be recognised), then "+ 2 more".
// Two at one company get their job title too ("Canonical · Site Reliability Engineer").
export function sessionLines(sessions, label) {
  const names = sessions.map(label);
  const twice = name => names.filter(other => other === name).length > 1;
  const lines = sessions.slice(0, SHOWN).map((session, i) => `•  ${twice(names[i]) && session.title ? `${names[i]} · ${session.title}` : names[i]}`);
  if (sessions.length > SHOWN) lines.push(t('native.moreSessions', {count: sessions.length - SHOWN}));
  return lines;
}

// Why (2026-10-28, owner: "Always close it"; localization 7 Nov 2026): the hidden browser still closes with the app; translate this explanation without changing that behavior.
const afterOf = sessions => t(sessions.some(session => session.background) ? 'native.afterHidden' : 'native.afterForms');

// Only Claude sessions are working (the queue is empty): keep them, or stop them and quit.
// `cloud` (cs 4/4, owner's yes 10 Nov 2026: "Yes + 'Stop and quit' in case 3"; lib/cloud-quit.js offerFor): for a Pro install with Full automation applications working, what Always on does for them:
// 'off' offers to turn it on and quit, 'setup' to set it up first (the app stays open), 'on' says a quit hands them to the cloud browser (Stop and quit still stops them). Keep working stays the default.
export function sessionsOnly(sessions, label, cloud = null) {
  const one = sessions.length === 1, who = sessions.every(session => session.background) ? t('native.hiddenBrowser') : 'Claude';
  const third = {off: 'quitTurnOn', setup: 'quitSetUpAlways', on: 'quitHandOver'}[cloud];
  const why = third ? t({off: 'native.quitAlwaysOffDetail', setup: 'native.quitAlwaysSetupDetail', on: 'native.quitAlwaysOnDetail'}[cloud]) : t(one ? 'native.stoppingOne' : 'native.stoppingMany', {after: afterOf(sessions)});
  return {
    message: t(one ? 'native.sessionsOne' : 'native.sessionsMany', {who, count: sessions.length}),
    detail: `${sessionLines(sessions, label).join('\n')}\n\n${why}`,
    buttons: [t('native.keepWorking'), t('native.stopQuit'), ...(third ? [t(`native.${third}`)] : [])],
  };
}

// Searches, queued jobs and/or sessions: quit when they finish, quit now, or stay.
export function working({busy = null, queue = [], sessions = [], important = [], taskName, label}) {
  const lines = important.map(what => t('native.importantQuit', {what: criticalLabel(what)}));
  if (busy) lines.push(t('native.busyQuit', {task: taskLabel(busy.kind, taskName)}));
  if (queue.length) lines.push(t(queue.length === 1 ? 'native.queueOne' : 'native.queueMany', {count: queue.length, tasks: queue.map(job => taskLabel(job.kind, taskName)).join(', ')}));
  if (sessions.length) lines.push(t(sessions.length === 1 ? 'native.claudeOne' : 'native.claudeMany', {count: sessions.length, names: sessions.slice(0, SHOWN).map(label).join(', ') + (sessions.length > SHOWN ? '…' : '')}));
  if (important.length && !busy && !queue.length && !sessions.length) {   // only an export, a Notion setup…: no jobs to run again
    return {message: t('native.stillWorking'), detail: `${lines.join('\n')}\n\n${t('native.finishImportant')}`,
      buttons: [t('native.quitDone'), t('native.quitNow'), t('native.cancel')]};
  }
  return {
    message: t('native.stillWorking'),
    detail: `${lines.join('\n')}\n\n${t('native.finishWork')}` +
      (sessions.length ? `\n\n${afterOf(sessions)}` : ''),
    buttons: [t('native.quitDone'), t('native.quitNow'), t('native.cancel')],
  };
}
