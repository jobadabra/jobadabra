// The words of Always on's Test button (card row #aon-test, pages/always-on-test.js), pure so one test reads every sentence a person can meet. Guard: test/unit/renderer/always-on-test-words.test.js.
// Why (4 Nov 2026, owner: "a test button that will do a simple test of the e2e flow"): the button says what it does and what it does not (no search, nothing sent), and a failed
// check is named in the engine's own words, so nobody has to open GitHub to learn which of the three things is wrong.

export const NAME = 'Test Always on';
export const FOR = 'Checks in your own GitHub repository that GitHub, Notion and your API key work together. It searches and sends nothing.'; // about Notion

export const OURS_CLOSED = 'Our servers are not open yet, so there is nothing to test. This button will check them the day they open.';

/** The sentence under the title: why the button is off, or what it does. `missing` lists the names still to set up above (the three the card shows); `way` is 'own' or 'ours' (closed: our servers are not open). */
export function lead(missing, way = 'own') {
  if (way === 'ours') return OURS_CLOSED;
  if (!missing.length) return FOR;
  return `Set up ${list(missing)} above first: the test needs all three.`;
}

/** One name as is, two joined by "and", three or more with commas and a last "and". */
export function list(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** The status pill: [text, tone] for pill() in components.js. `phase` is idle, starting, running, passed, failed or cancelled. */
export function pillFor(phase) {
  return {
    idle: null,
    starting: ['Starting', 'info'],
    running: ['Testing', 'info'],
    passed: ['Passed', 'good'],
    failed: ['Failed', 'bad'],
    cancelled: ['Stopped', 'neutral'],
  }[phase] || null;
}

/** The button: "Test Always on" the first time, "Test again" after a result, busy while a test runs. */
export function buttonFor(phase) {
  if (phase === 'starting' || phase === 'running') return {text: 'Testing…', busy: true};
  return {text: phase === 'idle' ? NAME : 'Test again', busy: false};
}

/** One check's chip: the word beside its icon (never colour alone). */
export function chipFor(state) {
  return {
    waiting: {text: 'Waiting', tone: 'neutral'},
    running: {text: 'Checking', tone: 'info'},
    ok: {text: 'Works', tone: 'good'},
    failed: {text: 'Failed', tone: 'bad'},
    skipped: {text: 'Not run', tone: 'neutral'},
    cancelled: {text: 'Stopped', tone: 'neutral'},
  }[state] || {text: 'Waiting', tone: 'neutral'};
}

/** The one line under the checks once a test ended (empty while it runs). */
export function summary(phase, steps) {
  if (phase === 'passed') return 'All three work. Your next scheduled run can use them.';
  if (phase === 'cancelled') return 'That test was stopped, probably by a second press. Press Test again.';
  if (phase !== 'failed') return '';
  const bad = steps.find(item => item.state === 'failed');
  return bad ? `${bad.title}: no. Fix that one, then press Test again.` : 'The test ended before every check ran. Open the run to see why, then press Test again.';
}

/** The sentence when the run could not even be started (GitHub refused, not connected). */
export const startFailed = error => `The test did not start: ${String(error || 'GitHub did not answer.').replace(/\s+/g, ' ').slice(0, 200)}`;

/** The sentence when nothing shows up after a while: GitHub lists a new run within seconds, so this is a stuck start, not a slow test. */
export const NEVER_LISTED = 'GitHub has not listed the test run yet. Open the repository and look under Actions, or press Test again.';
