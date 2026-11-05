// renderer/live-view-state.js: the one owner of what a hidden application's live view does (owner, 5 Nov 2026: the preview "should not show by default, only on request";
// "Try again" for ever). Each case below is a scenario the owner reported or the review of [ap] 7/7 found.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DROPPED, NOT_YET, START, step, streaming} from '../../../renderer/live-view-state.js';

const run = (events, from = START) => events.reduce(({state, effects}, event) => { const next = step(state, event); return {state: next.state, effects: [...effects, next.effect].filter(Boolean)}; }, {state: from, effects: []});
const GONE = 'This application\'s form is no longer open in Jobadabra\'s browser.';

test('nothing streams until Watch live; Watch live asks once, the picture shows, Hide closes it', () => {
  assert.equal(run([{type: 'page', open: true}, {type: 'picture'}, {type: 'filling'}, {type: 'dropped'}]).effects.length, 0, 'drawing and redrawing a card asks main for nothing');
  const watched = run([{type: 'watch'}, {type: 'watch'}, {type: 'answer', ask: 1, ok: true}, {type: 'picture'}]);
  assert.deepEqual([watched.state.kind, watched.effects], ['showing', ['open']], 'one press, one ask');
  const hidden = run([{type: 'hide'}], watched.state);
  assert.deepEqual([hidden.state.kind, hidden.effects, streaming(hidden.state)], ['hidden', ['close'], false]);
});

test('Hide, then Watch live again before main answered: the old answer changes nothing and the new ask is made (review: a spinner for ever)', () => {
  const {state, effects} = run([{type: 'watch'}, {type: 'hide'}, {type: 'watch'}, {type: 'answer', ask: 1, ok: false, error: 'The live page was closed before it opened.'}]);
  assert.deepEqual([state.kind, state.ask, effects], ['opening', 2, ['open', 'close', 'open']]);
  assert.equal(run([{type: 'answer', ask: 2, ok: true}, {type: 'picture'}], state).state.kind, 'showing');
  assert.equal(run([{type: 'watch'}, {type: 'hide'}, {type: 'answer', ask: 1, ok: true}]).state.kind, 'hidden', 'an ok that lands after Hide does not reopen');
});

test('a page that is gone says so with nothing to press; it never asks again by itself (the "Try again" for ever)', () => {
  const closed = run([{type: 'watch'}, {type: 'answer', ask: 1, ok: false, closed: true, error: GONE}]);
  assert.deepEqual([closed.state.kind, closed.state.note], ['closed', GONE]);
  assert.deepEqual(run([{type: 'watch'}, {type: 'picture'}, {type: 'dropped'}], closed.state).effects, [], 'closed offers nothing and asks nothing');
  const checked = run([{type: 'page', open: false, error: GONE}]);
  assert.equal(checked.state.kind, 'closed', 'the page check alone says closed before any press');
});

test('a closed note is not kept for ever: a new fill or a check that finds the page brings Watch live back (review: stale "closed")', () => {
  const closed = run([{type: 'page', open: false, error: GONE}]).state;
  assert.equal(step(closed, {type: 'filling'}).state.kind, 'hidden');
  assert.equal(step(closed, {type: 'page', open: true}).state.kind, 'hidden');
  assert.equal(step(closed, {type: 'page', open: null}).state.kind, 'closed', 'a browser that cannot tell changes nothing');
});

test('a check that finds the page gone while it streams closes the stream (review: a stream behind a closed note)', () => {
  const streamingNow = run([{type: 'watch'}, {type: 'answer', ask: 1, ok: true}, {type: 'picture'}]).state;
  assert.deepEqual([step(streamingNow, {type: 'page', open: false, error: GONE}).state.kind, step(streamingNow, {type: 'page', open: false, error: GONE}).effect], ['closed', 'close']);
});

test('a job just claimed has no page yet: Watch live says so and offers it again, never "closed" and never a spinner for ever', () => {
  const {state} = run([{type: 'watch'}, {type: 'answer', ask: 1, ok: false, closed: true, error: GONE, filling: true}]);
  assert.deepEqual([state.kind, state.note], ['hidden', NOT_YET]);
  assert.equal(run([{type: 'page', open: false, error: GONE, filling: true}]).state.kind, 'hidden');
});

test('main dropped the view while it streamed: the note says so and Watch live is offered; pictures after Hide count for nothing', () => {
  const showing = run([{type: 'watch'}, {type: 'answer', ask: 1, ok: true}, {type: 'picture'}]).state;
  assert.deepEqual([step(showing, {type: 'dropped'}).state.kind, step(showing, {type: 'dropped'}).state.note], ['hidden', DROPPED]);
  assert.equal(run([{type: 'hide'}, {type: 'picture'}], showing).state.kind, 'hidden');
  const failed = run([{type: 'watch'}, {type: 'answer', ask: 1, ok: false, error: 'Jobadabra\'s browser did not answer.'}]).state;
  assert.deepEqual([failed.kind, failed.note], ['hidden', 'Jobadabra\'s browser did not answer.']);
});
