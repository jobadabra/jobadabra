// The AI user agent's findings core (5/11): a note must be an argument, the cap ranks and never loses, the judge never flips a note by failing, and the Finder files it with its labels and its argument.
import test from 'node:test';
import assert from 'node:assert/strict';
import {agentLabels, MAX_FILED, rankNotes, toFinding, validateNote} from '../../lib/agent-notes.mjs';
import {judgeNote, judgePrompt} from '../../lib/agent-judge.mjs';
import {GOAL_VERDICTS, summarizeSession, summaryMarkdown} from '../../lib/agent-session.mjs';
import {normalize} from '../../lib/triage-findings.mjs';
import {agentBlock, issueBody, labelsFor} from '../../lib/triage-issues.mjs';
import {DETECTORS} from '../../lib/selfheal-stats.mjs';

const RAW = {type: 'data', kind: 'wrong-result', severity: 'high', view: 'profile', title: 'Answer saved as the question label',
  expected: 'profile-4 a saved answer is the value the person typed', observed: 'The stored answer for Phone reads "Phone number".', why: 'The next application would send the label as the phone number.'};
const note = (over = {}) => ({...RAW, ...over});
const ok = (raw, knowledgeIds = ['profile-4']) => validateNote(raw, {knowledgeIds, views: ['profile', 'jobs']});

test('a note is filed only as an argument: it cites a knowledge entry or names a UX principle, and says what it saw and why it matters', () => {
  assert.equal(ok(RAW).ok, true);
  assert.equal(ok(RAW).note.cites, 'profile-4');
  assert.equal(ok(note({expected: 'general UX: a button that is pressed shows a result'})).ok, true);
  assert.match(ok(note({expected: 'it should look nicer'})).why, /no argument: expected cites no knowledge entry/);
  assert.match(ok(note({observed: 'wrong'})).why, /no argument: observed and why/);
  assert.match(ok(note({why: ''})).why, /no argument: observed and why/);
});

test('a bad type, kind, severity or view is refused, never repaired', () => {
  assert.match(ok(note({type: 'vibes'})).why, /type "vibes"/);
  assert.match(ok(note({kind: 'ugly'})).why, /kind "ugly"/);
  assert.match(ok(note({severity: 'critical'})).why, /severity "critical"/);
  assert.match(ok(note({view: 'moon'})).why, /view "moon" is not a screen/);
  assert.match(ok(null).why, /not an object/);
});

test('the cap files proved notes first, then the judge-agreed, then the severe; low is never filed; nothing is lost from the report', () => {
  const many = Array.from({length: 15}, (_, i) => ({...RAW, title: `n${i}`, severity: 'medium', judge: 'agrees'}));
  many[14] = {...many[14], proved: true};
  many[13] = {...many[13], judge: 'disagrees'};
  many[12] = {...many[12], severity: 'high'};
  many.push({...RAW, title: 'nit', severity: 'low'});
  const {filed, over, low} = rankNotes(many);
  assert.equal(filed.length, MAX_FILED);
  assert.equal(filed[0].title, 'n14');
  assert.equal(filed[1].title, 'n12');
  assert.deepEqual(low.map(each => each.title), ['nit']);
  assert.equal(filed.length + over.length + low.length, many.length);
  assert.ok(over.some(each => each.title === 'n13'), 'the disagreed note is the one held back');
});

test('the finding carries the argument, the steps and who found it; the labels carry the type, persona, seed and the second opinion', () => {
  const finding = toFinding({...ok(RAW).note, judge: 'disagrees', judgeReason: 'the label is a placeholder', proved: false}, {steps: ['opened Profile', 'read the answers'], session: {persona: 'ines-lisbon', seed: 42, snapshot: 'abc1234'}});
  assert.equal(finding.source, 'ai-user-agent');
  assert.match(finding.detail, /Steps before it:\n1\. opened Profile\n2\. read the answers/);
  assert.deepEqual(agentLabels(finding.agent), ['agent-type:data', 'persona:ines-lisbon', 'judge:disagrees', 'needs-human']);
  assert.deepEqual(agentLabels({type: 'ui', judge: 'agrees', proved: true, seed: 7, persona: ''}), ['agent-type:ui', 'judge:agrees', 'proved']);   // a seed is never a label (it would grow the repo's label list every session)
});

test('the Finder accepts the source and keeps the argument; the issue says what it expected, why it matters and how to replay it; the detector has a name', () => {
  const finding = toFinding({...ok(RAW).note, judge: 'agrees', judgeReason: 'plausible', proved: true}, {steps: ['opened Profile'], session: {persona: 'ines-lisbon', seed: 42, snapshot: 'abc1234'}});
  const [filed] = normalize({ui: [finding]});
  assert.equal(filed.source, 'ai-user-agent');
  assert.equal(filed.expected, RAW.expected);
  assert.equal(filed.agent.persona, 'ines-lisbon');
  const body = issueBody(filed, 'https://example.test/run/1');
  assert.match(body, /### What it expected\nprofile-4 a saved answer/);
  assert.match(body, /### Why it matters\nThe next application would send the label/);
  assert.match(body, /persona `ines-lisbon`, seed `42`, snapshot `abc1234`\. Second opinion: \*\*agrees\*\* \(plausible\)\. Replayed without AI: it held\./);
  assert.ok(labelsFor(filed, 'ai-user-agent').includes('source:ai-user-agent'));
  assert.ok(labelsFor(filed).includes('agent-type:data'));
  assert.equal(DETECTORS['ai-user-agent'], 'AI user agent');
  assert.match(agentBlock({}), /Second opinion: \*\*unknown\*\*\. Not replayed without AI\./);
});

test('a note the Finder grades low is dropped and listed, never filed', () => {
  const dropped = [];
  assert.deepEqual(normalize({ui: [toFinding({...ok(RAW).note, severity: 'low'})], dropped}), []);
  assert.equal(dropped[0].source, 'ai-user-agent');
});

const ask = text => async () => ({text, usage: {}, tier: 'mid', engine: 'codex'});
test('the second opinion reads only the argument; a judge that gets no answer is "unavailable" (its note is held), one that answers in the wrong shape is "unknown", never a guess', async () => {
  const clean = ok(RAW).note;
  assert.doesNotMatch(judgePrompt({...clean, steps: ['secret step']}), /secret step/);
  assert.equal((await judgeNote({ask: ask('{"verdict":"agrees","reason":"The label is shown as the value."}'), note: clean})).verdict, 'agrees');
  assert.equal((await judgeNote({ask: ask('{"verdict":"disagrees","reason":"Fine as is."}'), note: clean})).verdict, 'disagrees');
  const refused = await judgeNote({ask: async () => { throw new Error('AI limit reached'); }, note: clean});
  assert.equal(refused.verdict, 'unavailable');
  assert.match(refused.reason, /AI limit reached/);
  assert.match((await judgeNote({ask: ask('sorry, I cannot'), note: clean})).reason, /did not answer in the asked shape/);
  assert.equal((await judgeNote({ask: ask('{"verdict":"maybe","reason":"x"}'), note: clean})).verdict, 'unknown');
});

test('a note whose second opinion was unavailable is held, not filed, and the report says so; a wrong-shape answer ("unknown") is still filed', () => {
  const notes = [note({title: 'agreed', judge: 'agrees'}), note({title: 'no judge', judge: 'unavailable'}), note({title: 'odd judge', judge: 'unknown'}), note({title: 'low and no judge', severity: 'low', judge: 'unavailable'}), note({title: 'proved, no judge', judge: 'unavailable', proved: true})];
  const {filed, over, low, held} = rankNotes(notes);
  assert.deepEqual(filed.map(each => each.title), ['proved, no judge', 'agreed', 'odd judge'], 'a script-proved note has its own evidence and is filed without the opinion');
  assert.deepEqual(held.map(each => each.title), ['no judge']);
  assert.deepEqual(low.map(each => each.title), ['low and no judge']);
  assert.equal(filed.length + over.length + low.length + held.length, notes.length, 'nothing is lost from the report');
  const summary = summarizeSession({session: 'n', persona: 'p', seed: 1, goals: [{n: 1, group: 'Jobs', label: 'Open a job'}], results: [{n: 1, verdict: 'worked', summary: 'ok', steps: 2}], notes});
  assert.equal(summary.held.length, 1);
  assert.match(summaryMarkdown(summary), /Filed 3, 1 low \(never filed\), 1 held \(the second opinion was unavailable\)\./);
});

test('a session accounts for every goal: a missing result is not started, an unknown verdict is doubts, and a quiet night has a result', () => {
  const goals = [{n: 1, group: 'Profile', label: 'Edit your phone number'}, {n: 2, group: 'Jobs', label: 'Open a job'}, {n: 3, group: 'Focus', label: 'Run the quick check'}];
  const summary = summarizeSession({session: 'night-1', persona: 'ines-lisbon', seed: 42, goals, results: [{n: 1, verdict: 'worked', summary: 'The value stayed after reopening.', steps: 7}, {n: 2, verdict: 'great', summary: 'odd', steps: 3}],
    notes: [], cost: {calls: 20, tokensIn: 90000, tokensOut: 18000, ms: 240000}});
  assert.deepEqual(summary.goals.map(goal => goal.verdict), ['worked', 'doubts', 'not-started']);
  assert.ok(summary.goals.every(goal => [...GOAL_VERDICTS, 'not-started'].includes(goal.verdict)));
  assert.equal(summary.steps, 10);
  const text = summaryMarkdown(summary);
  assert.match(text, /\*\*ines-lisbon\*\* \(seed `42`\): 1 worked, 1 doubts, 0 could not finish, 1 not started, 0 bugs\. Filed 0\. 20 AI calls, 108k gross tokens \(input \+ output\), 4 min\./);
  assert.match(text, /\| 3 \| Run the quick check \| ⏸ not-started \| the session ended before this goal \|/);
});
