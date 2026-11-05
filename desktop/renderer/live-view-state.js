// The one owner of what a hidden application's live view is doing: hidden, opening, showing or closed ([ap] 7/7; spec 2026-11-05-applying-redesign, decision 4).
// Guard: test/unit/renderer/live-view-state.test.js.

export const NOT_YET = 'The page is not open yet: it opens when the fill starts. Press Watch live again in a moment.';
export const DROPPED = 'The live page closed. Press Watch live to see it again.';
export const START = {kind: 'hidden', ask: 0, note: ''};
const STREAMING = new Set(['opening', 'showing']);

/** True while main streams (or is asked to stream) the page's picture. */
export const streaming = state => STREAMING.has(state.kind);

/**
 * Pure: the view's next state for one event, and what the view must do about it. -> {state, effect: ''|'open'|'close'}.
 * Events: {type: 'watch'} the person's Watch live; {type: 'hide'} Hide (or leaving the session); {type: 'answer', ask, ok, closed, error, filling} main's answer to liveOpen
 * number `ask`; {type: 'picture'} a picture arrived; {type: 'dropped'} main dropped the view on its own; {type: 'page', open: true|false|null, error, filling} main's livePage
 * (null: it could not tell); {type: 'filling'} the card shows a filling job.
 * Why (5 Nov 2026, owner: the preview "should not show by default, only on request", and "Try again" for ever; review of [ap] 7/7: four flags changed in four places left
 * a full-screen layer after Hide, a spinner for ever after Hide then Watch live, and a stream running behind a closed note): one state, one owner. Invariants: only Watch live
 * opens (nothing asks again by itself); a stale answer (an older ask) changes nothing; pictures count only while streaming; a closed page offers nothing to press until a
 * check or a new fill says the page may be back.
 */
export function step(state, event) {
  return (ON[event.type] || same)(state, event);
}
const same = state => ({state, effect: ''});
const to = (state, kind, note = '', effect = '') => ({state: {...state, kind, note}, effect});
// main's answer to ask number `ask`: an older ask, or one landing after Hide, changes nothing.
function answered(state, event) {
  if (event.ask !== state.ask || state.kind !== 'opening' || event.ok) return same(state);
  if (event.closed) return event.filling ? to(state, 'hidden', NOT_YET) : to(state, 'closed', event.error || '');
  return to(state, 'hidden', event.error || '');
}
// main's livePage: open brings Watch live back; gone (not a filling job) closes, ending a stream; null (could not tell) changes nothing.
function checked(state, event) {
  if (event.open === true) return state.kind === 'closed' ? to(state, 'hidden') : same(state);
  if (event.open === false && !event.filling) return to(state, 'closed', event.error || '', streaming(state) ? 'close' : '');
  return same(state);
}
const ON = {
  watch: state => (state.kind === 'hidden' ? {state: {kind: 'opening', ask: state.ask + 1, note: ''}, effect: 'open'} : same(state)),
  hide: state => (streaming(state) ? to(state, 'hidden', '', 'close') : same(state)),
  answer: answered,
  picture: state => (state.kind === 'opening' ? to(state, 'showing') : same(state)),
  dropped: state => (streaming(state) ? to(state, 'hidden', DROPPED) : same(state)),
  page: checked,
  filling: state => (state.kind === 'closed' ? to(state, 'hidden') : same(state)),
};
