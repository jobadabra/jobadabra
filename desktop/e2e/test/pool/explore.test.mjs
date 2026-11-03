// The AI explorer, with a fake AI and a fake page: it only does what the probe may press, answers one JSON action a turn, stops at its caps (steps, broker calls, minutes), counts what each
// tier spent, hands a bug to a replay that needs no AI, and a bug whose check does not hold again is not a finding.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ACTIONS, CHECKS, actionSchema, allowed, explore, formatObservation, parseAction, replay, segmentFor, stepWords} from '../../lib/explore.mjs';
import {normalize, issueTitle} from '../../lib/triage.mjs';

const seen = {view: 'jobs', text: 'Jobs\nNo jobs yet', overlays: [], controls: [
  {i: 0, kind: 'button', label: 'Sort by name', disabled: false, cls: '', href: '', type: ''},
  {i: 1, kind: 'button', label: 'Delete all jobs', disabled: false, cls: '', href: '', type: ''},
  {i: 2, kind: 'field', label: 'Search', disabled: false, cls: '', href: '', type: 'text'},
  {i: 3, kind: 'field', label: 'Key', disabled: false, cls: '', href: '', type: 'password'}]};
const BLANK = {control: -1, text: '', key: '', view: '', title: '', kind: '', severity: '', what: '', check_type: '', check_text: '', check_control: '', summary: ''};
// One broker answer: the action JSON as text, what it cost, the tier and engine that answered.
const turn = (action, fields = {}, {tier = 'small', engine = 'codex', ms = 7000} = {}) => ({text: JSON.stringify({...BLANK, action, ...fields}), usage: {input_tokens: 1000, output_tokens: 100}, ms, tier, engine});
const fakeAct = (log = []) => ({observe: async () => seen, click: async i => log.push(['click', i]), type: async (i, text) => log.push(['type', i, text]), press: async key => log.push(['press', key]), go: async view => log.push(['go', view]),
  readText: async () => 'Jobs No jobs yet', errorMark: () => 0, errorsSince: () => [], measure: async () => ({changed: false, calls: 0}), log});
const script = answers => async () => answers.shift();

test('what it may press is what the probe may press: no delete, no password field', () => {
  assert.deepEqual(seen.controls.map(allowed), [true, false, true, false]);
  assert.match(formatObservation(seen), /1 · button · Delete all jobs \[not allowed\]/);
  assert.match(formatObservation(seen), /3 · field · Key \[not allowed\]/);
});

test('a refused control is never pressed; an allowed one is; the run ends on done', async () => {
  const act = fakeAct();
  const ask = script([turn('click', {control: 1}), turn('go', {view: 'jobs'}), turn('click', {control: 0}), turn('done')]);
  const result = await explore({act, ask, views: ['jobs'], caps: {maxSteps: 10}});
  assert.deepEqual(act.log, [['go', 'jobs'], ['click', 0]]);
  assert.equal(result.stopped, 'done');
  assert.deepEqual(result.trace.map(row => row.action), ['click', 'go', 'click', 'done']);
});

test('a page or key outside the lists is refused, not performed', async () => {
  const act = fakeAct();
  const result = await explore({act, ask: script([turn('go', {view: 'admin'}), turn('press', {key: 'Enter'}), turn('done')]), views: ['jobs'], caps: {maxSteps: 5}});
  assert.deepEqual(act.log, []);
  assert.equal(result.spent.calls, 3);
});

test('it stops at the step cap, at the broker-call cap and at the minute cap on its own clock', async () => {
  const forever = async () => turn('press', {key: 'Escape'});
  assert.equal((await explore({act: fakeAct(), ask: forever, views: [], caps: {maxSteps: 3}})).stopped, 'steps');
  const byCalls = await explore({act: fakeAct(), ask: forever, views: [], caps: {maxSteps: 50, maxCalls: 4}});
  assert.equal(byCalls.stopped, 'calls 4');
  assert.equal(byCalls.spent.calls, 4);
  let minutes = 0;
  const byTime = await explore({act: fakeAct(), ask: forever, views: [], caps: {maxSteps: 50, maxCalls: 50, maxMinutes: 3}, now: () => (minutes++) * 60000});
  assert.equal(byTime.stopped, 'minutes 3');
  assert.ok(byTime.spent.calls >= 1 && byTime.spent.calls <= 3);
});

test('what each call used is counted per tier, with a row per turn for the session record', async () => {
  const ask = script([turn('press', {key: 'Tab'}), turn('press', {key: 'Tab'}, {ms: 9000}), turn('done', {}, {tier: 'mid', engine: 'claude', ms: 20000})]);
  const result = await explore({act: fakeAct(), ask, views: [], caps: {maxSteps: 5}});
  assert.deepEqual(result.spent, {calls: 3, input: 3000, output: 300, ms: 36000, tiers: {small: {calls: 2, input: 2000, output: 200, ms: 16000}, mid: {calls: 1, input: 1000, output: 100, ms: 20000}}});
  assert.deepEqual(result.trace.map(row => [row.n, row.tier, row.engine, row.tokens]), [[1, 'small', 'codex', 1100], [2, 'small', 'codex', 1100], [3, 'mid', 'claude', 1100]]);
});

test('an answer that is not one JSON action is refused and still counted; the run goes on', async () => {
  const act = fakeAct();
  const bad = {text: 'I will press the first button', usage: {input_tokens: 10, output_tokens: 5}, ms: 1, tier: 'small'};
  const result = await explore({act, ask: script([bad, {...bad, text: JSON.stringify({action: 'dance'})}, turn('click', {control: 0}), turn('done')]), views: [], caps: {maxSteps: 6}});
  assert.deepEqual(act.log, [['click', 0]]);
  assert.equal(result.spent.calls, 4);
  assert.match(parseAction('```json\n{"action":"done"}\n```').action, /done/, 'a fenced answer is still one action');
  assert.match(parseAction('x').error, /JSON/);
});

test('a broker refusal ends the run and nothing is trusted from it', async () => {
  const result = await explore({act: fakeAct(), ask: async () => { throw new Error('capped broker: out of budget'); }, views: [], caps: {maxSteps: 5}});
  assert.match(result.stopped, /^api: capped/);
  assert.equal(result.spent.calls, 0);
});

test('the answer shape is strict: every field required, nothing else allowed, the pages and keys are its choices', () => {
  const schema = actionSchema(['jobs', 'focus']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
  assert.deepEqual(schema.properties.action.enum, ACTIONS);
  assert.deepEqual(schema.properties.view.enum, ['', 'jobs', 'focus']);
  assert.deepEqual(schema.properties.check_type.enum, ['', ...CHECKS]);
});

test('a report needs a check a script can verify; its steps start at the latest go', async () => {
  const ask = script([turn('go', {view: 'jobs'}), turn('click', {control: 0}), turn('go', {view: 'focus'}), turn('click', {control: 0}),
    turn('report_bug', {title: 'Sort does nothing', kind: 'functionality', severity: 'high', what: 'x', check_type: ''}),
    turn('report_bug', {title: 'Sort does nothing', kind: 'functionality', severity: 'high', what: 'x', check_type: 'dead_control', check_control: 'Sort by name'}), turn('done')]);
  const result = await explore({act: fakeAct(), ask, views: ['jobs', 'focus'], caps: {maxSteps: 10}});
  assert.equal(result.bugs.length, 1, 'a report with no valid check is refused');
  assert.deepEqual(result.bugs[0].steps.map(step => step.tool), ['go', 'click']);
  assert.equal(result.bugs[0].steps[0].view, 'focus');
  assert.deepEqual(result.bugs[0].check, {type: 'dead_control', text: '', control: 'Sort by name'});
  assert.deepEqual(CHECKS, ['text_visible', 'text_missing', 'console_error', 'dead_control']);
});

test('a replay needs no AI: each check holds or does not', async () => {
  const bug = check => ({steps: [{tool: 'go', view: 'jobs'}, {tool: 'click', label: 'Sort by name', kind: 'button'}], check});
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'text_visible', text: 'No jobs yet'})})).reproduced, true);
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'text_visible', text: 'Something else'})})).reproduced, false);
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'text_missing', text: 'Something else'})})).reproduced, true);
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'text_visible', text: '  '})})).reproduced, false, 'an empty text proves nothing');
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'console_error'})})).reproduced, false);
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'dead_control', control: 'Sort by name'})})).reproduced, true);
  const gone = await replay({act: fakeAct(), bug: {steps: [{tool: 'click', label: 'Nothing here', kind: 'button'}], check: {type: 'console_error'}}});
  assert.equal(gone.reproduced, false);
  assert.match(gone.why, /not on the page/);
});

test('the steps read as a person would say them', () => {
  assert.equal(stepWords({tool: 'go', view: 'jobs'}), 'Open jobs');
  assert.equal(stepWords({tool: 'click', label: 'Sort'}), 'Press "Sort"');
  assert.equal(segmentFor([{tool: 'go', view: 'a'}, {tool: 'click', label: 'x'}, {tool: 'go', view: 'b'}, {tool: 'click', label: 'y'}], 4).length, 2);
});

test('a proved explorer report becomes a finding with its own source, title and a capped severity', () => {
  const [finding] = normalize({ui: [{view: 'jobs', severity: 'high', kind: 'layout', title: 'Sort button is cut off', detail: 'It is cut off. Replayed without AI.', source: 'explorer'}]});
  assert.equal(finding.source, 'explorer');
  assert.equal(finding.severity, 'medium', 'a layout finding is never high, whatever the AI said');
  assert.match(issueTitle(finding), /layout on jobs: Sort button is cut off/);
  const [wrong] = normalize({ui: [{view: 'jobs', severity: 'high', kind: 'functionality', title: 'Sort does nothing', detail: 'Pressing it changes nothing.', source: 'explorer'}]});
  assert.equal(wrong.severity, 'high');
});
