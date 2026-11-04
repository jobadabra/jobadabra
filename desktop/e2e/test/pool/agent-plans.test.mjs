// The replay proof's named plans: each of the four tester bugs has a plan that names what a person does and never the defect, the plan becomes a session plan, and a rule can be taken out of what the agent knows.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import {NAMED_PLANS, SHAPES, namedPlan, rulesOff, shapeFor, withoutRules} from '../../lib/agent-plans.mjs';
import {seedPlanData, waitCvRead} from '../../lib/agent-seed.mjs';
import {FILE as CV_READ_FILE, hashOf} from '../../../lib/cv-read-key.js';
import {readExpectations} from '../../lib/agent-memory.mjs';
import {knowledgeFor} from '../../lib/agent-knowledge.mjs';

const EXPECTATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/app-expectations');

test('the four tester bugs each have a plan whose rule exists in the knowledge base and whose goals never name the defect', () => {
  const expectations = readExpectations(EXPECTATIONS), ids = Object.values(expectations).flat().map(entry => entry.id);
  assert.deepEqual(Object.keys(NAMED_PLANS), ['learned-questions', 'saved-answers', 'languages', 'inbound']);
  for (const [id, plan] of Object.entries(NAMED_PLANS)) {
    assert.ok(ids.includes(plan.rule), `${id}: the rule ${plan.rule} is in docs/app-expectations`);
    for (const goal of plan.goals) assert.doesNotMatch(goal.label, /bare label|never|wrong|bug|Not checked|e-?mail subject|level grid/i, `${id}: the goal must not name the defect`);
  }
});

test('a named plan is a session plan with numbered goals; an unknown id says which plans exist', () => {
  const plan = namedPlan('inbound', 20261103);
  assert.deepEqual([plan.seed, plan.persona.name, plan.goals.length, plan.goals[0].n, plan.goals[0].group], [20261103, 'named plan inbound', 1, 1, 'Jobs']);
  assert.throws(() => namedPlan('nope', 1), /no named plan "nope": the plans are learned-questions, saved-answers, languages, inbound/);
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

test('a night with free goals seeds the one shape its seed picks; a pinned name, none and a named plan override it', () => {
  assert.deepEqual(Object.keys(SHAPES), ['headings', 'languages', 'inbound']);
  assert.equal(shapeFor(20261103), shapeFor(20261103), 'the same seed picks the same shape');
  assert.equal(new Set([0, 1, 2].map(n => shapeFor(n))).size, 3, 'three consecutive seeds reach all three shapes');
  for (const odd of [1.5, Infinity, NaN, -7, 0, 20261105.5, '20261103', 1e300]) assert.ok(Object.hasOwn(SHAPES, shapeFor(odd)), `seed ${odd} still picks a shape`);
  assert.throws(() => shapeFor(1, 'constructor'), /no shape "constructor"/);
  assert.equal(shapeFor(20261103, 'inbound'), 'inbound');
  assert.equal(shapeFor(20261103, 'none'), '');
  assert.equal(shapeFor(20261103, '', 'languages'), '', 'a named plan seeds its own data, no shape');
  assert.throws(() => shapeFor(1, 'nope'), /no shape "nope": the shapes are headings, languages, inbound, or none/);
});

test('a shape puts its data in the app: the CV with its read answered, or the inbound rows; a named plan keeps its own', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-shape-')), made = [];
  const ctx = {profile, proxy: {canned: () => null, setCanned: () => {}}, data: async (store, command, args) => { made.push([store, command, args.job?.origin]); return {id: made.length}; }};
  assert.match(await seedPlanData(ctx, '', 20261103, 'inbound'), /^seeded for shape inbound: .*3 inbound rows/);
  assert.deepEqual(made.map(row => row[2]), ['Inbound', 'Inbound', 'Inbound']);
  assert.ok(!fs.existsSync(path.join(profile, 'cv.pdf')), 'the inbound shape leaves the CV alone');
  assert.match(await seedPlanData(ctx, '', 20261103, 'headings'), /^seeded for shape headings: CV of .*headingLines/);
  assert.ok(fs.statSync(path.join(profile, 'cv.pdf')).size > 0);
  assert.equal(await seedPlanData(ctx, '', 20261103, ''), '', 'no shape and no plan changes nothing');
  made.length = 0;
  assert.match(await seedPlanData(ctx, 'inbound', 20261103, 'headings'), /^seeded for inbound: 3 inbound rows$/, 'the plan wins over the shape');
  fs.rmSync(profile, {recursive: true});
});

test('after a CV shape the run waits for the app to keep its CV read; an inbound shape or no shape waits for nothing', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-wait-'));
  const ctx = {profile, proxy: {canned: () => null, setCanned: () => {}}, data: async () => ({id: 1})};
  assert.equal(await waitCvRead(ctx, '', 'inbound'), 0);
  assert.equal(await waitCvRead(ctx, '', ''), 0);
  await seedPlanData(ctx, '', 20261103, 'languages');
  const file = path.join(profile, CV_READ_FILE), hash = hashOf({path: name => path.join(profile, name)});
  const waiting = waitCvRead(ctx, '', 'languages');   // the read is not kept yet: a wait that skipped the shape would return at once
  const early = await Promise.race([waiting.then(() => 'returned'), new Promise(resolve => setTimeout(resolve, 100, 'still waiting'))]);   // Why: proves "not yet returned" on a clock of the test's own, not a wait for app state
  assert.equal(early, 'still waiting');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({cv: hash, facts: []}));
  assert.ok(await waiting > 0, 'a kept read of this CV ends the wait');
  fs.rmSync(profile, {recursive: true});
});
