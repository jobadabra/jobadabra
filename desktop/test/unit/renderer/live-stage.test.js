// The live view never shows a broken image (owner screenshot, 28 Oct 2026: "let's have a nicer UI handling when we cannot show the live preview for some reason,
// instead of this broken image"), and nothing streams until the person asks (owner, 5 Nov 2026: the preview "should not show by default, only on request";
// "Try again" for ever on a page that was gone). renderer/live-frames.js stageState decides what the stage draws.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stageState} from '../../../renderer/live-frames.js';

const CLOSED = 'This application\'s form is no longer open in Jobadabra\'s browser: it was stopped, cancelled or the app restarted. Open in my browser opens the job in your own browser.';

test('hidden: the note and Watch live; a filling card and one that takes clicks say different things', () => {
  const off = stageState({kind: 'hidden'});
  assert.deepEqual([off.kind, off.title, off.action], ['off', 'The page is hidden', 'Watch live']);
  assert.match(off.text, /fills in Jobadabra's hidden browser.*only when you ask/);
  assert.match(stageState({kind: 'hidden', input: true}).text, /review it, click and type in it/);
});

test('opening: "opening" until a picture is painted; showing: the picture', () => {
  assert.equal(stageState({kind: 'opening'}).kind, 'waiting');
  assert.deepEqual(stageState({kind: 'showing'}), {kind: 'picture'});
});

test('a closed page says why and offers nothing to press: asking again never brings it back', () => {
  const closed = stageState({kind: 'closed', note: CLOSED});
  assert.deepEqual([closed.kind, closed.title, closed.text, closed.action], ['closed', 'The page is closed', CLOSED, '']);
});

test('a failed open of a page that exists says so and offers Watch live again; no state says "Try again"', () => {
  const failed = stageState({kind: 'hidden', note: 'The live page could not be opened. Press Watch live to ask again, or use Open in my browser.'});
  assert.deepEqual([failed.kind, failed.action], ['off', 'Watch live']);
  assert.match(failed.text, /could not be opened/);
  for (const state of [{}, {kind: 'opening'}, {kind: 'closed', note: CLOSED}, {kind: 'hidden', note: 'The live page could not be opened.'}, {input: true}]) {
    const out = stageState(state);
    assert.ok(!/try again/i.test(JSON.stringify(out)), JSON.stringify(state));
    if (out.kind !== 'picture') assert.ok(out.title.length > 5 && out.text.length > 5, out.kind);
  }
});
