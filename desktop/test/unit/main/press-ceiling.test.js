// A press is 3 minutes for a person; only a search-tape recording may give it more (the press's yardstick ceiling, docs/superpowers/plans/2026-11-07-the-press.md 2/6).
import test from 'node:test';
import assert from 'node:assert/strict';

const budgetWith = async (env) => {
  const saved = {...process.env};
  Object.assign(process.env, env);
  try {
    return (await import(`../../../lib/pipeline-args.js?ceiling=${Math.random()}`)).SEARCH_BUDGET_S;
  } finally {
    for (const key of Object.keys(env)) if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
  }
};

test('a press is 3 minutes unless a tape is recording', async () => {
  assert.equal(await budgetWith({}), 180);
  assert.equal(await budgetWith({JOBADABRA_PRESS_SECONDS: '900'}), 180, 'the seconds alone change nothing');
  assert.equal(await budgetWith({JOBADABRA_PRESS_SECONDS: '900', JOBADABRA_SEARCH_TAPE_MODE: 'replay'}), 180, 'a replay keeps the press');
  assert.equal(await budgetWith({JOBADABRA_PRESS_SECONDS: '900', JOBADABRA_SEARCH_TAPE_MODE: 'record'}), 900, 'a recording takes the ceiling');
  assert.equal(await budgetWith({JOBADABRA_PRESS_SECONDS: '60', JOBADABRA_SEARCH_TAPE_MODE: 'record'}), 180, 'never shorter than a press');
});
