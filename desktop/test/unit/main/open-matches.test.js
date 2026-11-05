// The count behind the thin-search ask (lib/open-matches.js): an integer from the engine's read-only step, or null; never a guess, never a throw.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openInPlaces} from '../../../lib/open-matches.js';

const exec = (stdout, code = 0) => async () => ({stdout, code});

test('the count is the last JSON line of the engine step; anything else is unknown', async () => {
  assert.equal(await openInPlaces({}, exec('noise\n{"open_in_places": 3}\n')), 3);
  assert.equal(await openInPlaces({}, exec('{"open_in_places": 0}')), 0);
  for (const bad of ['', 'not json', '{"open_in_places": "3"}', '{"open_in_places": -1}', '{"other": 1}']) assert.equal(await openInPlaces({}, exec(bad)), null, bad);
  assert.equal(await openInPlaces({}, exec('{"open_in_places": 3}', 1)), null, 'a failed step is unknown, not 3');
  assert.equal(await openInPlaces({}, async () => { throw new Error('no engine'); }), null);
});
