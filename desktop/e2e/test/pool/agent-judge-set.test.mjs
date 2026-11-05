// Guard: money. The judge exam spends 66 broker calls by hand; when the broker refuses it stops at the first call instead of scoring a refusal (its other parts are checked by running the exam once).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {askSet} from '../../lib/agent-judge-set.mjs';

// Guard: money. A refused broker is not a score. The judge answers "unavailable" when its call throws; the exam stops there with the reason instead of scoring it as a verdict.
test('the exam stops on the first unavailable answer and scores nothing', async () => {
  const notes = [{n: 1, view: 'jobs', label: 'real', title: 't', type: 'data', severity: 'low', expected: 'e', observed: 'o', why: 'w', image: 'AAAA'}];
  const refused = async () => { throw new Error('429 broker: budget'); };
  for (const variant of ['before', 'after']) await assert.rejects(askSet({ask: refused, notes, expectations: {}, variant, runs: 3}), /judge exam stopped at note 1 \(\w+, run 1\): the second opinion could not answer: 429 broker: budget/);
});
