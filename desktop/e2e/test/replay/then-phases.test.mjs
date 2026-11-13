// Guard: release — a recorded page's later step (`then` as a list) could fail unseen or unnamed, and the replay would pass a multi-step form it never judged.
// Why (13 Nov 2026, owner on #4026: "push the suggestions from this PR in the next one"): Gitar asked for a test of the list form of `then`. Pure: fake judge and press, no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {judgeCase} from '../../lib/page-replay.mjs';

// A scope whose judge answers each phase from `verdicts` (phase index → failures) and records which phases it judged and which presses happened.
function fakeScope(verdicts) {
  const judged = [], pressed = [];
  const scope = {
    page: {name: 'tab'}, pages: () => [],
    judge: async item => { const index = judged.length; judged.push(item.expect); const failures = verdicts[index] || []; return {ok: !failures.length, failures, confirm: []}; },
    press: async (tab, step) => { pressed.push(step); },
  };
  return {scope, judged, pressed};
}
const phase = name => ({do: [{click: `#${name}`}, {panel: 'Fill again'}], expect: {name}});

test('every phase of a list is judged in order, each after its own presses', async () => {
  const {scope, judged, pressed} = fakeScope({});
  const result = await judgeCase({expect: {name: 'first'}, then: [phase('second'), phase('third')]}, scope);
  assert.equal(result.ok, true);
  assert.deepEqual(judged.map(expect => expect.name), ['first', 'second', 'third']);
  assert.deepEqual(pressed.map(step => step.click || step.panel), ['#second', 'Fill again', '#third', 'Fill again']);
});

test('a later phase failing is named by its index, and no phase after it runs', async () => {
  const {scope, judged} = fakeScope({1: ['valueIs: #q1']});
  const result = await judgeCase({expect: {name: 'first'}, then: [phase('second'), phase('third')]}, scope);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ['then 1: valueIs: #q1']);
  assert.equal(judged.length, 2);
});

test('a first judgment failing stops the case before any press', async () => {
  const {scope, pressed} = fakeScope({0: ['valueIs: #email']});
  const result = await judgeCase({expect: {name: 'first'}, then: [phase('second')]}, scope);
  assert.deepEqual(result.failures, ['valueIs: #email']);
  assert.equal(pressed.length, 0);
});

test('a single `then` object still reports a plain "then:"', async () => {
  const {scope} = fakeScope({1: ['chosen: #ea-resume-1']});
  const result = await judgeCase({expect: {name: 'first'}, then: phase('second')}, scope);
  assert.deepEqual(result.failures, ['then: chosen: #ea-resume-1']);
});

// Why (13 Nov 2026, Gitar on #4056, Rule E: the Easy Apply case dropped its step-2 "Fill again" press): step 2 is filled by the fill itself after Next, the way a person sees it
// (a filled form shows no Fill button, so the press had nothing to do); the case still judges that step, and this pins it so the press cannot vanish with its assertion.
test('the Easy Apply stand-in judges step 2 filled with no panel press: Next, then the resume chosen by the fill itself', async () => {
  const {loadCases} = await import('../../lib/page-replay.mjs');
  const item = loadCases().find(one => one.name === 'linkedin-easy-apply-dialog-1');
  assert.ok(item, 'the recorded Easy Apply stand-in is loaded');
  const [step2] = item.then;
  assert.deepEqual(step2.do, [{click: 'role=button[name="Next"]'}], 'step 2 is reached by the page\'s own Next, and nothing presses the panel');
  assert.deepEqual(step2.expect.chosen, ['#ea-resume-1'], 'step 2 is judged: the fill chose the resume by itself');
  assert.deepEqual(step2.expect.notTold, ['pressed the submit'], 'and nothing sent');
  const {scope, judged, pressed} = fakeScope({});
  assert.equal((await judgeCase(item, scope)).ok, true);
  assert.deepEqual(judged[1], step2.expect, 'the judge sees step 2\'s own expectation');
  assert.equal(pressed.filter(step => step.panel).length, 1, 'the one panel press left is step 3\'s, the free-text questions');
});
