// The live step log of each hidden-browser application: what happened and when, in plain words, for the Sessions page's "What happened" (owner,
// 5 Nov 2026: "We should have live update log … so that the user gets a good sense even without live preview or opening in the browser").
// The one owner of these lines. A log exists only from a run's start (start(), lib/background-apply-controller.js enqueue); every later step of
// a session with no log is dropped, so a Chrome session, a session restored after a restart and a removed one never get one, and the page
// derives their steps instead (renderer/session-steps-list.js). Writers: the controller (each background state, backgroundStep()), the page the
// extension sees and the form's fill count (note()), the record's stuck reason and submit (observe()). Guard: test/unit/main/session-journal.test.js.

import {MODES} from '../renderer/apply-settings-model.js';

// Why (5 Nov 2026, [ap] 5/7): a run of 10 forms writes many lines a second; the page only needs its latest steps.
export const KEEP = 30;
// Why (5 Nov 2026, [ap] 5/7): a tell redraws the Sessions page; one tell per burst for every session keeps 10 forms at ~3 redraws a second.
const TELL_MS = 300;

const journals = new Map(), stuckSeen = new Map();
let tell = () => {}, later = (fn, ms) => setTimeout(fn, ms).unref?.(), pending = false;

/** Called once per burst of new lines (any session): the window reads the list again. `later` is the timer (a test passes its own). */
export function onChange(fn, {later: timer} = {}) {
  tell = fn;
  if (timer) later = timer;
}

/** -> the session's steps, oldest first: [{at, text, tone, key?}]; [] for a session with no log. */
export const journalOf = id => [...(journals.get(String(id || '')) || [])];

/** Forgets a session's steps (it was removed). */
export function forget(id) {
  journals.delete(String(id || ''));
  stuckSeen.delete(String(id || ''));
}

/**
 * A hidden-browser run starts: its log begins (a new log, whatever an old run of the same id said), its first line naming the mode it runs in
 * (spec 2026-11-05-applying-redesign.md, acceptance 1 and 3: the first log line names the mode and says "in Jobadabra's browser").
 */
export function start(id, mode = '', at = Date.now()) {
  id = String(id || '');
  if (!id) return;
  const title = MODES.find(entry => entry.id === mode && entry.runner === 'background')?.title;
  journals.set(id, []);
  note(id, {text: `Started in Jobadabra's browser${title ? ` · ${title}` : ''}`, at});
}

/**
 * Adds one step to a session that has a log (start()). The same words as the last step add nothing; a step with the same `key` as the last one
 * (the fill count) is updated in place, so "2 of 9" becomes "6 of 9" instead of a new line. tone: 'done' (default) or 'warn' (needs the person).
 */
export function note(id, {text = '', key = '', tone = 'done', at = Date.now()} = {}) {
  id = String(id || '');
  text = String(text || '').trim();
  const steps = journals.get(id), last = steps?.at(-1);
  if (!steps || !text || last?.text === text) return;
  const step = {at, text, tone, ...(key ? {key} : {})};
  if (key && last?.key === key) steps[steps.length - 1] = step;
  else steps.push(step);
  journals.set(id, steps.slice(-KEEP));
  if (pending) return;
  pending = true;
  later(() => { pending = false; tell(); }, TELL_MS);
}

// A hidden-browser application's states (lib/background-apply-store.js) as steps; a state not listed here is said by its record's note.
const BACKGROUND_STEPS = {
  queued: 'Waiting for its turn', preflight: 'Opening the job page', filling: 'Filling the form',
  ready_for_review: 'Every required field filled: review it, then Submit',
  waiting_to_submit: 'Every required field filled: it sends by itself after the wait, unless you press Stop', submitting: 'Pressing Submit',
  receipt_confirmed: 'The site confirmed the application',
  cloud: 'Handed to our cloud browser: it sends this application by itself, even with your computer off',
};
const HANDED = new Set(['needs_user_handoff', 'manual_submit_required']);

/** -> the step for a background state; `words` is what the controller tells the person about it (a hand-over's reason). */
export function backgroundStep(state, words = '') {
  if (HANDED.has(state)) return {text: `Handed to you: ${words || 'review and submit it yourself'}`, tone: 'warn'};
  return {text: BACKGROUND_STEPS[state] || words, tone: 'done'};
}

/**
 * The session record changed (lib/terminals.js onChange's 'update' payload, its public view): a new stuck reason (amber) and the submit become
 * steps of its log. A removed session ({removed: true}) forgets its log. A Stop is said by the hand-over that follows it, not twice.
 */
export function observe(view, at = Date.now()) {
  const id = String(view?.id || '');
  if (!id || !journals.has(id)) return;
  if (view.removed) return forget(id);
  const stuck = view.stuck || '', was = stuckSeen.get(id) || '';
  stuckSeen.set(id, stuck);
  if (view.outcome === 'submitted') return note(id, {text: 'Submitted · marked Applied', at});
  if (stuck && stuck !== was && stuck !== 'stopped') note(id, {text: view.note || 'Needs you', tone: 'warn', at});
}

/** Test only: starts from nothing. */
export function _reset() {
  journals.clear();
  stuckSeen.clear();
  tell = () => {};
  later = (fn, ms) => setTimeout(fn, ms).unref?.();
  pending = false;
}
