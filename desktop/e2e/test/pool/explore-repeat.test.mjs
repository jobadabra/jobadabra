// The explorer's loop (shared with the AI user agent) stops a goal that does the same thing on the same page again and again (replays 41857211406 and 41857218091, 4 Nov 2026: 93 of 100 steps on
// two buttons, "Expand all" 39 times and a tab 54 times, on a page that never changed). It nudges at the 3rd time, ends the goal at the 5th, and never touches a page that does change.
// Guard: efficiency — without it one stuck goal spends the whole night's steps and calls on a button that does nothing, and the goals after it never run.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {explore} from '../../lib/explore.mjs';
import {runSession} from '../../lib/agent-run.mjs';
import {planSession} from '../../lib/agent-plan.mjs';

const control = (i, label) => ({i, kind: 'button', label, disabled: false, cls: '', href: '', type: ''});
const page = (text = 'Profile') => ({view: 'profile', text, overlays: [], controls: [control(0, 'Expand all'), control(1, 'Save')]});
const BLANK = {control: -1, text: '', key: '', view: '', title: '', kind: '', severity: '', what: '', check_type: '', check_text: '', check_control: '', summary: '', type: '', expected: '', observed: '', why: '', verdict: ''};
const click = control => ({text: JSON.stringify({...BLANK, action: 'click', control}), usage: {input_tokens: 10, output_tokens: 5}, ms: 1, tier: 'small', engine: 'codex'});
const stop = {text: JSON.stringify({...BLANK, action: 'done', verdict: 'worked', summary: 'ok'}), usage: {input_tokens: 10, output_tokens: 5}, ms: 1, tier: 'small', engine: 'codex'};
const rig = (observe, answers) => {
  const seenByAi = [], rest = [...answers];
  return {seenByAi, act: {observe: async () => observe(), click: async () => {}, type: async () => {}, press: async () => {}, go: async () => {}},
    ask: async ({messages}) => { seenByAi.push(messages.at(-1).content); return rest.shift() || stop; }};
};

test('the same click on an unchanged page is nudged at the 3rd time and ends the goal at the 5th', async () => {
  const {act, ask, seenByAi} = rig(() => page(), Array.from({length: 40}, () => click(0)));
  const result = await explore({act, ask, views: ['profile'], caps: {maxSteps: 40}});
  assert.equal(result.trace.length, 5, 'five turns, not forty');
  assert.match(result.stopped, /^repeat: "Press "Expand all"" 5 times on the same page$/);
  assert.equal(seenByAi.filter(text => /nothing new came of it/.test(text)).length, 1, 'one nudge, at the 3rd time');
  assert.match(seenByAi[3], /you have done "Press "Expand all"" 3 times/, 'the nudge is the reply to the 3rd press');
});

test('two buttons pressed in turn on a page that never changes are one loop too', async () => {
  const {act, ask} = rig(() => page(), Array.from({length: 40}, (_, n) => click(n % 2)));
  const result = await explore({act, ask, views: ['profile'], caps: {maxSteps: 40}});
  assert.ok(result.trace.length <= 10, `ended at ${result.trace.length} turns`);
  assert.match(result.stopped, /^repeat: /);
});

test('the same click on a page that changes each time is never a loop', async () => {
  let n = 0;
  const {act, ask} = rig(() => page(`Profile ${n++}`), [...Array.from({length: 12}, () => click(0)), stop]);
  const result = await explore({act, ask, views: ['profile'], caps: {maxSteps: 40}});
  assert.equal(result.stopped, 'done');
  assert.equal(result.trace.length, 13);
});

test('a goal that loops is a could-not-finish that says so, and the goal after it still runs', async () => {
  const plan = planSession({seed: 7, moves: [{group: 'Profile', label: 'Edit your phone number'}, {group: 'Jobs', label: 'Open a job'}], count: 2});
  const {act, ask} = rig(() => page(), [...Array.from({length: 5}, () => click(0)), stop]);
  const result = await runSession({act, ask, judgeAsk: async () => ({text: '{}', usage: {}, tier: 'mid'}), views: ['profile'], plan, knowledgeIds: [], caps: {maxSteps: 60}});
  const [first, second] = result.summary.goals;
  assert.equal(first.verdict, 'could-not-finish');
  assert.match(first.summary, /kept doing the same thing, "Press "Expand all"" 5 times on the same page, and the page did not change/);
  assert.doesNotMatch(first.summary, /ran out of room/);
  assert.equal(second.verdict, 'worked', 'the second goal had its steps');
});
