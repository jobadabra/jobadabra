// The steps of a session in plain words ("What happened", pages/session-steps.js draws them). No imports and no window: test/unit/renderer/session-steps.test.js feeds it sessions and
// form reports. `submitted` and `time` come from the page (session-state.js isSubmitted, activity.js clockTime).
// The reasons where the page says what to do, or the site is broken: nothing for Claude to finish (desktop/lib/application-journey.js INFORM; test/unit/renderer/session-steps.test.js keeps them equal).
export const INFORM_STUCK = ['email', 'told', 'other', 'site_broken'];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
  if (item.stuck === 'stopped') return item.note || 'Stopped by you';
  if (item.stuck === 'account') return item.note || 'This site needs an account';
  if (item.stuck === 'incomplete') return item.note || 'Nothing could be filled; required fields are empty';
  if (INFORM_STUCK.includes(item.stuck)) return item.note || (item.stuck === 'site_broken' ? 'The site did not answer' : 'The page says what to do');   // the address is in the note: nothing is sent for you
  if (item.stuck === 'no-form') return /^Needs you:/.test(item.note || '') ? item.note : 'No application form found on the page yet';   // a bot check in front of the form says so
  return '';
}

// The steps the window derives from the session and its form report: a Chrome session, or a hidden one whose log is gone (the app restarted).
function derivedSteps(item, state, submitted, time) {
  const steps = [{tone: 'done', text: `Opened the job in Chrome${item.startedAt ? ` · ${time(item.startedAt)}` : ''}`}];
  const stuck = stuckStep(item);
  if (stuck) steps.push({tone: 'warn', text: stuck});
  const total = Number(state?.total) || 0, left = Math.max(0, Number(state?.left) || 0);
  if (total && !state.account) {
    steps.push({tone: 'done', text: `Read the form: ${plural(total, 'required field')}`});
    steps.push({tone: 'done', text: `Filled ${total - left} of ${total}`});
    const suggested = (state.proposals || []).filter(proposal => proposal?.value).length;
    if (suggested) steps.push({tone: 'done', text: `${plural(suggested, 'answer')} suggested for you to check`});
  }
  if (submitted) steps.push({tone: 'done', text: 'Submitted · marked Applied'});
  else if (item.status === 'running' && (item.note || 'Working…') !== steps.at(-1).text) steps.push({tone: 'now', text: item.note || 'Working…'});   // never the line just said (an email posting's note is its warning)
  else if (total && !state.account) steps.push({tone: 'now', text: left ? `Your turn: ${plural(left, 'field')} left, then submit in Chrome` : 'Your turn: review and submit in Chrome'});
  return steps;
}

