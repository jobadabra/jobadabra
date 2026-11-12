// The steps of a session in plain words ("What happened", pages/session-steps.js draws them). No imports and no window: test/unit/renderer/session-steps.test.js feeds it sessions and
// form reports. `submitted` and `time` come from the page (session-state.js isSubmitted, activity.js clockTime).
// The reasons where the page says what to do, or the site is broken: nothing for Claude to finish (desktop/lib/application-journey.js INFORM; test/unit/renderer/session-steps.test.js keeps them equal).
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const INFORM_STUCK = ['email', 'told', 'other', 'site_broken'];

// A hidden-browser session's own live log (lib/session-journal.js, sent with the session list), each step with its time. Its latest step is
// "now" while the application still runs (not handed to you, not sent). Why (5 Nov 2026, owner: "We should have live update log … so that the user
// gets a good sense even without live preview"): the derived steps said "Opened the job in Chrome" for a form no Chrome tab ever had.
const journalSteps = (item, submitted, time) => {
  const steps = item.journal.map(step => ({tone: step.tone === 'warn' ? 'warn' : 'done', text: `${step.text} · ${time(step.at)}`}));
  const last = steps.at(-1);
  if (!submitted && !item.outcome && last.tone === 'done') last.tone = 'now';
  return steps;
};

// → [{tone: 'done'|'warn'|'now', text}], oldest first. Pure: the test feeds it sessions and form reports.
// `clock` writes a live-log step's time (to the second; default `time`).
export function sessionSteps(item, state = null, {submitted = false, time = at => at, clock = time} = {}) {
  return item.background && item.journal?.length ? journalSteps(item, submitted, clock) : derivedSteps(item, state, submitted, time);
}

// The words of the reason a session stopped and needs the person; '' when it is not stuck.
function stuckStep(item) {
  if (item.stuck === 'stopped') return item.note || t('helperState.stoppedYou');
  if (item.stuck === 'account') return item.note || t('helperState.siteNeedsAccount');
  if (item.stuck === 'incomplete') return item.note || t('helperState.nothingCouldFill');
  if (INFORM_STUCK.includes(item.stuck)) return item.note || (item.stuck === 'site_broken' ? t('helperState.siteNoAnswer') : t('helperState.pageSays'));   // the address is in the note: nothing is sent for you
  if (item.stuck === 'no-form') return /^Needs you:/.test(item.note || '') ? item.note : t('helperState.noFormYet');   // a bot check in front of the form says so
  return '';
}

// What the session lived through before now (`earlier`, lib/application-journey.js): a Stop that Reopen form or a new Fill cleared, and each reopen (#3408).
const EARLIER = {stopped: () => t('helperState.stoppedYou'), 'stopped-other': () => t('helperState.stoppedOther'),
  reopened: (step, time) => t('helperState.reopenedChrome', {when: step.at ? ` · ${time(step.at)}` : ''})};

// The steps the window derives from the session and its form report: a Chrome session, or a hidden one whose log is gone (the app restarted).
function derivedSteps(item, state, submitted, time) {
  const steps = [{tone: 'done', text: t('helperState.openedChrome', {when: item.startedAt ? ` · ${time(item.startedAt)}` : ''})}];
  for (const step of item.earlier || []) if (EARLIER[step.what]) steps.push({tone: 'done', text: EARLIER[step.what](step, time)});
  const stuck = stuckStep(item);
  if (stuck) steps.push({tone: 'warn', text: stuck});
  const total = Number(state?.total) || 0, left = Math.max(0, Number(state?.left) || 0);
  if (total && !state.account) {
    steps.push({tone: 'done', text: t('helperState.readFormFields', {count: total})});
    steps.push({tone: 'done', text: t('helperState.filledOf', {done: total - left, total})});
    const suggested = (state.proposals || []).filter(proposal => proposal?.value).length;
    if (suggested) steps.push({tone: 'done', text: t('helperState.answersSuggested', {count: suggested})});
  }
  if (submitted) steps.push({tone: 'done', text: t('helperState.submittedMarked')});
  else if (item.status === 'running' && (item.note || t('helperState.workingEllipsis')) !== steps.at(-1).text) steps.push({tone: 'now', text: item.note || t('helperState.workingEllipsis')});   // never the line just said (an email posting's note is its warning)
  else if (total && !state.account) steps.push({tone: 'now', text: left ? t('helperState.yourTurnFields', {count: left}) : t('helperState.yourTurnSubmit')});
  return steps;
}

