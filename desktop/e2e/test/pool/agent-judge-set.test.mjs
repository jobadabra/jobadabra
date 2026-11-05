// The judge exam's pure parts: the set loads, a score counts real notes kept and false notes dropped by majority, the table says both, and the judge's prompt carries the area's rules and the picture guidance.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {askSet, BEFORE_SYSTEM, knowledgeOf, loadSet, scoreRows, tableMarkdown} from '../../lib/agent-judge-set.mjs';
import {judgePrompt, SYSTEM} from '../../lib/agent-judge.mjs';
import {readExpectations} from '../../lib/agent-memory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the recorded set has 11 notes, 7 real and 4 false, each with its screenshot', () => {
  const notes = loadSet(path.join(here, '../../fixtures/agent-judge-set'));
  assert.equal(notes.length, 11);
  assert.equal(notes.filter(note => note.label === 'real').length, 7);
  assert.ok(notes.every(note => note.image.length > 1000 && note.cause));
});

test('a score counts a real note kept when its majority agrees and a false one dropped when its majority disagrees', () => {
  const rows = [{n: 1, label: 'real', verdicts: ['agrees', 'agrees', 'disagrees']}, {n: 2, label: 'real', verdicts: ['disagrees', 'disagrees', 'agrees']}, {n: 3, label: 'false', verdicts: ['disagrees', 'unknown', 'disagrees']}, {n: 4, label: 'false', verdicts: ['agrees', 'agrees', 'agrees']}];
  const score = scoreRows(rows);
  assert.deepEqual([score.keptReal, score.realTotal, score.droppedFalse, score.falseTotal], [1, 2, 1, 2]);
  assert.deepEqual(score.perRun, [{keptReal: 1, droppedFalse: 1}, {keptReal: 1, droppedFalse: 0}, {keptReal: 1, droppedFalse: 1}]);
  assert.match(tableMarkdown(score, score), /\| before \| 1 of 2 \| 1 of 2 \|/);
});

// Guard: prompt. The judge's two causes of the 5 Nov tour run: it had no rules and it read words missing from the picture as proof of a wrong report.
test('the judge prompt carries the area rules and tells the judge a missing quote is not proof; the old baseline does neither', () => {
  const expectations = readExpectations(path.join(here, '../../../../docs/app-expectations'));
  const note = {n: 2, view: 'jobs', title: 'x', type: 'data', severity: 'medium', expected: 'e', observed: 'o', why: 'w'};
  const knowledge = knowledgeOf(note, expectations);
  assert.match(knowledge, /jobs-3/);
  assert.match(judgePrompt(note, knowledge), /What is known about the app:[\s\S]*jobs-3[\s\S]*Report: x/);
  assert.match(SYSTEM, /missing from the picture are NOT proof/);
  assert.doesNotMatch(BEFORE_SYSTEM, /missing from the picture|rules/);
});

// Guard: a refused broker is not a score. The judge answers "unavailable" when its call throws; the exam stops there with the reason instead of scoring it as a verdict.
test('the exam stops on the first unavailable answer and scores nothing', async () => {
  const notes = [{n: 1, view: 'jobs', label: 'real', title: 't', type: 'data', severity: 'low', expected: 'e', observed: 'o', why: 'w', image: 'AAAA'}];
  const refused = async () => { throw new Error('429 broker: budget'); };
  for (const variant of ['before', 'after']) await assert.rejects(askSet({ask: refused, notes, expectations: {}, variant, runs: 3}), /judge exam stopped at note 1 \(\w+, run 1\): the second opinion could not answer: 429 broker: budget/);
});
