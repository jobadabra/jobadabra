// The replay proof's named plans: each of the four tester bugs has a plan that names what a person does and never the defect, the plan becomes a session plan, and a rule can be taken out of what the agent knows.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NAMED_PLANS, namedPlan, rulesOff, withoutRules} from '../../lib/agent-plans.mjs';
import {readExpectations} from '../../lib/agent-memory.mjs';
import {knowledgeFor} from '../../lib/agent-knowledge.mjs';

const EXPECTATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/app-expectations');

test('the four tester bugs each have a plan whose rule exists in the knowledge base and whose goals never name the defect', () => {
  const expectations = readExpectations(EXPECTATIONS), ids = Object.values(expectations).flat().map(entry => entry.id);
  assert.deepEqual(Object.keys(NAMED_PLANS), ['learned-questions', 'saved-answers', 'languages', 'inbound', 'board', 'tour']);
  for (const [id, plan] of Object.entries(NAMED_PLANS)) {
    assert.ok(ids.includes(plan.rule), `${id}: the rule ${plan.rule} is in docs/app-expectations`);
    for (const goal of plan.goals) assert.doesNotMatch(goal.label, /bare label|never|wrong|bug|Not checked|e-?mail subject|level grid/i, `${id}: the goal must not name the defect`);
  }
});

test('a named plan is a session plan with numbered goals; an unknown id says which plans exist', () => {
  const plan = namedPlan('inbound', 20261103);
  assert.deepEqual([plan.seed, plan.persona.name, plan.goals.length, plan.goals[0].n, plan.goals[0].group], [20261103, 'named plan inbound', 1, 1, 'Jobs']);
  assert.throws(() => namedPlan('nope', 1), /no named plan "nope": the plans are learned-questions, saved-answers, languages, inbound, board, tour/);
});

test('a rule taken out is neither read by the agent nor citable; the others stay', () => {
  assert.deepEqual(rulesOff(' profile-1, jobs-3 ,,'), ['profile-1', 'jobs-3']);
  assert.deepEqual(rulesOff(''), []);
  const expectations = readExpectations(EXPECTATIONS), off = rulesOff('profile-1,jobs-3');
  const kept = withoutRules(expectations, off);
  const idsOf = value => Object.values(value).flat().map(entry => entry.id);
  assert.ok(idsOf(expectations).includes('profile-1') && idsOf(expectations).includes('jobs-3'));
  assert.ok(!idsOf(kept).includes('profile-1') && !idsOf(kept).includes('jobs-3'));
  assert.ok(idsOf(kept).includes('profile-2'), 'a rule not named stays');
  assert.doesNotMatch(knowledgeFor(['Profile', 'Jobs'], {expectations: kept, notes: {}}), /profile-1|jobs-3/);
  assert.match(knowledgeFor(['Profile', 'Jobs'], {expectations, notes: {}}), /profile-1/);
});
