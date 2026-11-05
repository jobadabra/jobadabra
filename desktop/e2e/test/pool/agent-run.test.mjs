// A whole AI user agent session played by a scripted model on a fake page: a goal ends with a verdict, an argued note is judged and filed, a note with no argument is sent back, the broker refusing ends the night
// but keeps what was found, and the explorer's own loop is unchanged when no agent extension is passed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AGENT_SYSTEM, agentExtend, goalIntro, runSession} from '../../lib/agent-run.mjs';
import {actionSchema, actionsOf, explore, parseAction} from '../../lib/explore.mjs';
import {planSession} from '../../lib/agent-plan.mjs';

const seen = {view: 'profile', text: 'Profile\nPhone: Phone number', overlays: [], controls: [{i: 0, kind: 'button', label: 'Save', disabled: false, cls: '', href: '', type: ''}]};
const BLANK = {control: -1, text: '', key: '', view: '', title: '', kind: '', severity: '', what: '', check_type: '', check_text: '', check_control: '', summary: '', type: '', expected: '', observed: '', why: '', verdict: ''};
const turn = (action, fields = {}, {tier = 'small'} = {}) => ({text: JSON.stringify({...BLANK, action, ...fields}), usage: {input_tokens: 1000, output_tokens: 100}, ms: 5000, tier, engine: 'codex'});
const fakeAct = (log = []) => ({observe: async () => seen, click: async i => log.push(['click', i]), type: async () => {}, press: async () => {}, go: async view => log.push(['go', view]), log});
const script = answers => async () => { const next = answers.shift(); if (next instanceof Error) throw next; return next; };
const MOVES = [{group: 'Profile', label: 'Edit your phone number'}, {group: 'Jobs', label: 'Open a job'}, {group: 'Focus', label: 'Run the quick check'}];
const plan = planSession({seed: 7, moves: MOVES, count: 3});
const NOTE = {type: 'data', kind: 'wrong-result', severity: 'high', view: 'profile', title: 'Phone saved as its label', expected: 'profile-4 a saved answer is what the person typed', observed: 'The phone number now reads "Phone number".', why: 'An application would send the label as the phone number.'};
const judge = verdict => async () => ({text: JSON.stringify({verdict, reason: 'because'}), usage: {input_tokens: 500, output_tokens: 50}, tier: 'mid', engine: 'codex'});
const done = (verdict, summary = 'ok') => turn('done', {verdict, summary});

test('the agent adds one action and its fields to the explorer shape; without the extension the explorer is unchanged', () => {
  const plain = actionSchema(['jobs']);
  assert.ok(!plain.properties.expected && !plain.properties.verdict);
  const extended = actionSchema(['jobs', 'profile'], agentExtend({knowledgeIds: [], views: [], goal: {n: 1}, sink: []}));
  assert.ok(extended.properties.action.enum.includes('note'));
  assert.deepEqual(Object.keys(extended.properties).filter(key => !(key in plain.properties)).sort(), ['expected', 'observed', 'type', 'verdict', 'why']);
  assert.ok(extended.properties.kind.enum.includes('unnamed-control') && extended.properties.kind.enum.includes('wrong-result'));
  assert.equal(parseAction(JSON.stringify({action: 'note'})).error, 'action must be one of click, type, press, go, report_bug, done');
  assert.equal(parseAction(JSON.stringify({action: 'note'}), ['note']).action, 'note');
  assert.match(AGENT_SYSTEM, /action note/);
  assert.match(AGENT_SYSTEM, /action go opens any page of the app by its name/, 'a goal on another page is reached with go, not by hunting for a menu (first real session, 3 Nov 2026)');
});

test('a night: three goals, one with an argued note that the second opinion agrees with, filed with its steps and the cost line', async () => {
  const act = fakeAct();
  const ask = script([turn('go', {view: 'profile'}), turn('click', {control: 0}), turn('note', NOTE), done('bug', 'The phone was saved as its label.'),
    turn('go', {view: 'jobs'}), done('worked', 'The job opened.'), done('doubts', 'The check looked slow.')]);
  const result = await runSession({act, ask, judgeAsk: judge('agrees'), views: ['profile', 'jobs', 'focus'], plan, knowledgeIds: ['profile-4'], caps: {maxSteps: 30}, session: {id: 'night-1', snapshot: 'abc1234'}});
  assert.deepEqual(result.summary.goals.map(goal => goal.verdict), ['bug', 'worked', 'doubts']);
  assert.equal(result.findings.length, 1);
  const [finding] = result.findings;
  assert.equal(finding.source, 'ai-user-agent');
  assert.equal(finding.agent.judge, 'agrees');
  assert.equal(finding.agent.snapshot, 'abc1234');
  assert.match(finding.detail, /Steps before it:\n1\. Open profile\n2\. Press "Save"/);
  assert.equal(result.summary.cost.calls, 8);   // 7 acting turns + 1 second opinion
  assert.deepEqual(result.observations, {[plan.goals[0].group]: [`${plan.goals[0].label}: The phone was saved as its label.`], [plan.goals[2].group]: [`${plan.goals[2].label}: The check looked slow.`]});
  assert.deepEqual(act.log, [['go', 'profile'], ['click', 0], ['go', 'jobs']]);
});

test('a note with no argument is sent back to the agent and never reaches the findings', async () => {
  const ask = script([turn('note', {...NOTE, expected: 'it should look nicer'}), turn('note', {...NOTE, expected: 'general UX: a saved value is shown as typed'}), done('bug')]);
  const result = await runSession({act: fakeAct(), ask, judgeAsk: judge('disagrees'), views: ['profile'], plan: {...plan, goals: [plan.goals[0]]}, knowledgeIds: ['profile-4']});
  assert.equal(result.notes.length, 1);
  assert.equal(result.trace[0].refused.startsWith('no argument'), true);
  assert.equal(result.findings[0].agent.judge, 'disagrees');
});

test('a second opinion that gets no answer holds the notes, asks once not once per note, and the summary names what was held', async () => {
  const ask = script([turn('note', NOTE), turn('note', {...NOTE, title: 'Phone shown twice', observed: 'The phone number is listed twice.'}), done('bug', 'Two problems.')]);
  let asked = 0;
  const judgeDown = async () => { asked++; throw new Error('503 broker: only-claude: ran-out'); };
  const {summaryMarkdown} = await import('../../lib/agent-session.mjs');
  const result = await runSession({act: fakeAct(), ask, judgeAsk: judgeDown, views: ['profile'], plan: {...plan, goals: [plan.goals[0]]}, knowledgeIds: ['profile-4']});
  assert.equal(asked, 1, 'after the first call with no answer the other notes are not asked (each would wait up to 180 s)');
  assert.deepEqual(result.notes.map(note => note.judge), ['unavailable', 'unavailable']);
  assert.match(result.notes[1].judgeReason, /not asked: the second opinion could not answer: 503 broker: only-claude: ran-out/);
  assert.equal(result.findings.length, 0, 'no note is filed unjudged');
  assert.equal(result.summary.held.length, 2);
  assert.equal(result.summary.cost.calls, 4, '3 acting turns + 1 second-opinion call; the note that was not asked costs nothing');
  const text = summaryMarkdown(result.summary);
  assert.match(text, /2 held \(the second opinion was unavailable\)/);
  assert.match(text, /\*\*Held, not filed \(the second opinion could not answer: 503 broker: only-claude: ran-out\):\*\*\n- Phone saved as its label \(profile\): The phone number now reads "Phone number"\.\n- Phone shown twice \(profile\)/);
});

test('when the broker refuses mid-night the goals not reached are "could not finish" and what was found is kept', async () => {
  const ask = script([turn('note', NOTE), done('bug', 'saved as label'), new Error('AI limit reached')]);
  const result = await runSession({act: fakeAct(), ask, judgeAsk: judge('unknown'), views: ['profile'], plan, knowledgeIds: ['profile-4']});
  assert.equal(result.stopped.startsWith('api:'), true);
  assert.deepEqual(result.summary.goals.map(goal => goal.verdict), ['bug', 'could-not-finish', 'could-not-finish']);
  assert.equal(result.findings.length, 1);
});

test('the session shares its steps between the goals and starts each with the goal and the knowledge', async () => {
  const prompts = [];
  const ask = async ({messages}) => { prompts.push(messages[0].content); return done('worked'); };
  await runSession({act: fakeAct(), ask, judgeAsk: judge('agrees'), views: [], plan, knowledge: '- jobs-1 a rule', caps: {maxSteps: 30}});
  assert.equal(prompts.length, 3);
  assert.equal(prompts[0], `${goalIntro(plan.goals[0], '- jobs-1 a rule')}\n\nStart. You have at most 10 steps.\n\n${(await import('../../lib/explore.mjs')).formatObservation(seen)}`);
  const lonely = await explore({act: fakeAct(), ask: async () => done('worked'), views: [], caps: {maxSteps: 2}});
  assert.equal(lonely.final.action, 'done');
});

test('an agent is not offered report_bug (its bugs would be lost): the answer shape has note instead, and a report_bug answer is refused', async () => {
  const extend = agentExtend({knowledgeIds: [], views: [], goal: {n: 1}, sink: []});
  assert.deepEqual(actionsOf(extend), ['click', 'type', 'press', 'go', 'done', 'note']);
  assert.ok(!actionSchema(['jobs'], extend).properties.action.enum.includes('report_bug'));
  const result = await explore({act: fakeAct(), ask: script([turn('report_bug', {title: 'x'}), done('worked')]), views: [], caps: {maxSteps: 3}, extend});
  assert.equal(result.bugs.length, 0);
  assert.equal(result.trace[0].action, 'invalid');
});

test('the second opinion sees the screen as it was when the note was made, not where the session ended', async () => {
  let shots = 0;
  const shoot = async () => `shot-${++shots}`;
  const judged = [];
  const judgeAsk = async ({messages}) => { judged.push(messages[0].content[0].source.data); return {text: JSON.stringify({verdict: 'agrees', reason: 'ok'}), usage: {}, tier: 'mid', engine: 'codex'}; };
  const ask = script([turn('note', NOTE), done('bug'), turn('go', {view: 'jobs'}), done('worked'), done('worked')]);
  await runSession({act: fakeAct(), ask, judgeAsk, views: ['profile', 'jobs'], plan, knowledgeIds: ['profile-4'], shoot});
  assert.deepEqual(judged, ['shot-1']);
  assert.equal(shots, 1);
});

// Guard: data. A session's notes are what the night keeps; a read or a scroll that fails under the screen reader (the page changed under it) must not lose the notes already made (code review of the screen reader, 5 Nov 2026).
test('the screen reader: a note is made with the picture taken after the quoted element is revealed, and a reveal that throws loses nothing', async () => {
  const problem = {type: 'data', kind: 'wrong-result', severity: 'high', view: 'profile', title: 'Phone saved as its label', expected: 'profile-4 a saved answer is what the person typed', observed: 'The phone number now reads "Phone number".', why: 'The person loses their number.'};
  const reader = async () => ({text: JSON.stringify({problems: [problem]}), usage: {input_tokens: 500, output_tokens: 50}});
  const run = async reveal => {
    const quotes = [], log = [];
    const act = {...fakeAct(), reveal: async words => { quotes.push(words); return reveal(words); }};
    const result = await runSession({act, ask: script([done('worked'), done('worked'), done('worked')]), judgeAsk: judge('agrees'), screenAsk: reader, views: ['profile', 'jobs', 'focus'], plan, knowledgeIds: ['profile-4'], caps: {maxSteps: 30},
      shoot: async () => 'png', log: line => log.push(line), session: {id: 'night-2', snapshot: 'abc1234'}});
    return {result, quotes, log};
  };
  const fine = await run(async () => true);
  assert.deepEqual(fine.quotes[0], ['Phone number'], 'the picture is taken after the first quoted word was brought into view');
  assert.equal(fine.result.findings.length, 1);
  const broken = await run(async () => { throw new Error('node detached'); });
  assert.equal(broken.result.findings.length, 1, 'the note is kept with the picture as it is');
  assert.ok(broken.log.some(line => /could not bring "Phone number" into view/.test(line)));
});
