// The words of Always on's Test button (card row #aon-test, pages/always-on-test.js), pure so one test reads every sentence a person can meet. Guard: test/unit/renderer/always-on-test-words.test.js.
// Why (4 Nov 2026, owner: "a test button that will do a simple test of the e2e flow"): the button says what it does and what it does not (no search, nothing sent), and a failed
// check is named in the engine's own words, so nobody has to open GitHub to learn which of the three things is wrong.

export const NAME = 'Test Always on';
export const FOR = 'Checks in your own GitHub repository that GitHub, Notion and your API key work together. It searches and sends nothing.'; // about Notion

export const OURS_FOR = 'Runs one real search on our servers now, with your profile, and e-mails you what it finds. It counts as one of your free runs.';

/** The sentence under the title: why the button is off, or what it does. `missing` lists the names still to set up above (the three the card shows); `way` is 'own' (your accounts) or 'ours' (our servers: nothing to set up first). */
export function lead(missing, way = 'own') {
  if (way === 'ours') return OURS_FOR;
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
export function summary(phase, steps, way = 'own') {
  if (phase === 'passed') return way === 'ours' ? 'Everything works on our servers. Your next daily run does the same.' : 'All three work. Your next scheduled run can use them.';
  if (way === 'ours' && phase === 'failed') {
    const bad = steps.find(item => item.state === 'failed');
    return bad ? `${bad.title}: no. Press Test again in a few minutes. If it fails again, e-mail contact@jobadabra.top.` : 'The test ended before every step ran. Press Test again in a few minutes.';
  }
  if (phase === 'cancelled') return 'That test was stopped (a second press, or GitHub\'s time limit). Press Test again.';
  if (phase !== 'failed') return '';
  const bad = steps.find(item => item.state === 'failed');
  return bad ? `${bad.title}: no. Fix that one, then press Test again.` : 'The test ended before every check ran. Open the run to see why, then press Test again.';
}

/** The sentence when the run could not even be started (GitHub refused, not connected). */
export const startFailed = (error, way = 'own') => `The test did not start: ${String(error || (way === 'ours' ? 'Jobadabra did not answer.' : 'GitHub did not answer.')).replace(/\s+/g, ' ').slice(0, 200)}`;

/** The sentence while GitHub has not listed the run yet (it lists a dispatched run within seconds, so this is a slow start, not a slow test). */
export const NOT_LISTED_YET = 'GitHub has not listed the test run yet. It can take a moment; the repository\'s Actions page shows it too.';
/** The sentence when it never does: the button is back, so the person can press again. */
export const NEVER_LISTED = 'GitHub never listed the test run. Open the repository and look under Actions, then press Test again.';
export const TOO_LONG = 'The test is taking far longer than it should. Open the run to see where it waits, then press Test again.';
export const TOO_LONG_OURS = 'The test is taking far longer than it should. Press Test again in a few minutes.';

const SOFT_MS = 30 * 1000, LISTED_BY_MS = 90 * 1000, GIVE_UP_MS = 6 * 60 * 1000;   // Why (4 Nov 2026, review of 3/3): a run lasts about a minute; every wait ends in a verdict, never a button that stays off for ever

/** One poll's decision, pure: from the phase, what the read said, the time since the press and whether a run was already seen -> {phase, message, again}. Every path out of starting/running ends in a verdict.
 *  Why (4 Nov 2026, Gitar on #3159): "never listed" is only true before the first sighting of the run; a failed read (network, GitHub 5xx) or a read after the run was seen keeps polling until the 6-minute limit. */
export function advance({phase, read, elapsedMs, seen = false, way = 'own'}) {
  const tooLong = way === 'ours' ? TOO_LONG_OURS : TOO_LONG;
  if (read.found) {
    if (read.verdict === 'running' && elapsedMs > GIVE_UP_MS) return {phase: 'failed', message: tooLong, again: false};
    return {phase: read.verdict, message: '', again: read.verdict === 'running'};
  }
  if (read.error || seen) return elapsedMs > GIVE_UP_MS ? {phase: 'failed', message: tooLong, again: false} : {phase, message: '', again: true};
  if (elapsedMs > LISTED_BY_MS) return {phase: 'failed', message: NEVER_LISTED, again: false};
  return {phase, message: elapsedMs > SOFT_MS ? NOT_LISTED_YET : '', again: true};
}
