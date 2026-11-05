// The words of Always on's Test button (card row #aon-test, pages/always-on-test.js), pure so one test reads every sentence a person can meet. Guard: test/unit/renderer/always-on-test-words.test.js.
// Why (4 Nov 2026, owner: "a test button that will do a simple test of the e2e flow"; 5 Nov 2026: "Direct check, ~5 s"): the button says what it does and what it does not (no search, no run on GitHub), and a failed
// check is named in plain words, so nobody has to open GitHub to learn which thing is wrong.

export const NAME = 'Test Always on';
export const FOR = 'Checks in about 5 seconds that your repository, your keys, Notion, your AI key and a test message to you all work. It starts nothing on GitHub and searches nothing.'; // about Notion

export const OURS_FOR = 'Checks in about 10 seconds that our servers hold your profile and the AI answers. Then it starts your first search and e-mails you what it finds. It counts as one of your free runs.';

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

/** The status pill: [text, tone] for pill() in components.js. `phase` is idle, starting, running, passed or failed. */
export function pillFor(phase) {
  return {
    idle: null,
    starting: ['Starting', 'info'],
    running: ['Testing', 'info'],
    passed: ['Passed', 'good'],
    failed: ['Failed', 'bad'],
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
  }[state] || {text: 'Waiting', tone: 'neutral'};
}

/** The button beside a check that depends on the person's own notification choice (the test e-mail): it opens a pop-up to switch, check and confirm them.
 *  Why (5 Nov 2026, owner: "a popup instead of plain message", "enable/check/confirm the notifications right away, from that page"). */
export const NOTIFY_CHECK = 'Check notifications';
/** The same button when the test message did not go out (nothing is switched on, or the address is not confirmed): it proposes to set a way up. */
export const NOTIFY_SETUP = 'Set up notifications';
/** The pop-up's first sentence: after a check that went through, or after one that found nothing able to reach the person (owner, 5 Nov 2026: "detect the notifications settings … or propose him to enable"). */
export const NOTIFY_LEAD = 'The test sends one message to every way you chose. Change a way here, then test again.';
export const NOTIFY_LEAD_PROPOSE = 'The test message did not reach you.';

/** The pop-up's lead when the test could not reach the person: the site's own sentence for the step (why), then what to do. */
export const proposeLead = note => `${String(note || NOTIFY_LEAD_PROPOSE).replace(/\s+/g, ' ').trim()} Change a way here, then test again.`;

/** Whether the pop-up should open by itself now, pure: the test has ended (`again` false), its notification step failed, and it was not already proposed for this press. -> the step, or null.
 *  Why (5 Nov 2026, owner: "propose him to enable the notification settings"; review): never mid-test, never twice for one press. */
export function shouldPropose({steps, again, proposed}) {
  if (proposed || again) return null;
  return steps.find(step => step.settings && step.state === 'failed') || null;
}

/** The one line under the checks once a test ended (empty while it runs, and empty when the failed step's own note says it). */
export function summary(phase, steps, way = 'own') {
  if (phase === 'passed') return way === 'ours' ? 'Everything works on our servers. Your next daily run does the same.' : 'Everything works. Your next scheduled run can use it.';
  if (phase !== 'failed') return '';
  const bad = steps.find(item => item.state === 'failed');
  if (bad?.settings) return `${bad.title}: no. Set up notifications, then test again.`;
  if (way === 'ours' && bad?.line) return '';   // Why (5 Nov 2026, hr): the failed step's row already carries the site's own note; a second "Press Test again" sentence contradicted it (a stopped or unconfirmed address is not fixed by pressing again)
  if (way === 'ours') return bad ? `${bad.title}: no. Press Test again in a few minutes. If it fails again, e-mail contact@jobadabra.top.` : 'The test ended before every step ran. Press Test again in a few minutes.';
  return bad ? `${bad.title}: no. Fix that one, then press Test again.` : 'The test ended before every check ran. Press Test again.';
}

/** The sentence when the run could not even be started (GitHub refused, not connected). */
export const startFailed = (error, way = 'own') => `The test did not start: ${String(error || (way === 'ours' ? 'Jobadabra did not answer.' : 'GitHub did not answer.')).replace(/\s+/g, ' ').slice(0, 200)}`;

export const TOO_LONG_OURS = 'The test is taking far longer than it should. Press Test again in a few minutes.';

const GIVE_UP_MS = 6 * 60 * 1000, GIVE_UP_STEPS_MS = 60 * 1000, SEARCH_WATCH_MS = 20 * 60 * 1000;   // Why (4 Nov 2026, review of 3/3; 5 Nov 2026, owner): our servers' steps take about 10 s (GIVE_UP_STEPS_MS), an older site's whole run minutes (GIVE_UP_MS); every wait ends in a verdict, never a button that stays off for ever; the first search is watched apart (SEARCH_WATCH_MS)

/** The first search on our servers, one line under the steps (empty while there is nothing to say). `search` is {state: running | ok | failed, found, note} from the site; it never changes the verdict above it.
 *  Why (5 Nov 2026, owner: "a test shuold not take more than 10 seconds"): the Test answers in about 10 s about the setup; the real search takes minutes and is told here, apart. */
export function searchLine(search) {
  if (!search) return '';
  if (search.state === 'running') return 'First search: running, results by e-mail in about 10 minutes';
  if (search.state === 'late') return 'Last search: no answer yet. If it finishes, the results come by e-mail.';
  if (search.state === 'failed') return `Last search: failed${search.note ? `: ${search.note}` : ''}`;
  return `Last search: ${search.found === 1 ? '1 new job' : `${search.found} new jobs`}`;
}

/** What to do with the first search after a read, pure: 'again' (re-read it in 15 s), 'late' (20 minutes since the press and still running: say "no answer yet" and stop) or 'done' (nothing to watch:
 *  it ended, the site sent none, or the verdict failed, so no e-mail is promised). Why (5 Nov 2026, review): a failed test must not promise an e-mail, and the line must not say "running" for ever. */
export function searchWatch(search, phase, elapsedMs) {
  if (phase !== 'passed' || search?.state !== 'running') return 'done';
  return elapsedMs > SEARCH_WATCH_MS ? 'late' : 'again';
}

/** One poll's decision on our servers, pure: from the phase, what the read said and the time since the press -> {phase, message, again}. Every path out of starting/running ends in a verdict.
 *  Why (4 Nov 2026, Gitar on #3159): a failed read (network, 5xx) keeps polling until the limit, never ends the test at once. Why (5 Nov 2026, owner): with a `search` in the answer the verdict is about the steps
 *  only (about 10 s), so a verdict still running after a minute is stuck; a running search never counts. The own-accounts way is one direct call and needs no polling. */
export function advance({phase, read, elapsedMs}) {
  const giveUp = read.search ? GIVE_UP_STEPS_MS : GIVE_UP_MS;
  if (read.found) {
    if (read.verdict === 'running' && elapsedMs > giveUp) return {phase: 'failed', message: TOO_LONG_OURS, again: false};
    return {phase: read.verdict, message: '', again: read.verdict === 'running'};
  }
  return elapsedMs > giveUp ? {phase: 'failed', message: TOO_LONG_OURS, again: false} : {phase, message: '', again: true};
}
