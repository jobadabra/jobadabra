// The AI user agent's day plan, person and moves (lib/agent-plan.mjs, agent-persona.mjs, agent-moves.mjs): replayable from a seed, different every day, never repeating the last week's order, always covering an area that changed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OWN_MOVES, movesFromPalette, poolOf} from '../../lib/agent-moves.mjs';
import {CV_SHAPES, makePersona} from '../../lib/agent-persona.mjs';
import {MIN_NEW, WINDOW, newShare, pairsOf, planSession, recordSession} from '../../lib/agent-plan.mjs';

const GROUPS = ['Go to', 'Actions', 'Profile', 'Strategy', 'Jobs', 'Focus', 'Settings'];
const MOVES = GROUPS.flatMap(group => Array.from({length: 4}, (_, i) => ({group, label: `${group} move ${i + 1}`})));   // 28 moves in 7 areas

/** The share of plan A's pairs that plan B does not have. */
const apart = (a, b) => { const have = new Set(b.goals.map(goal => goal.pair)); return a.goals.filter(goal => !have.has(goal.pair)).length / a.goals.length; };

test('the same seed gives the same plan and the same person; another seed does not', () => {
  const plan = planSession({seed: 7, moves: MOVES});
  assert.deepEqual(planSession({seed: 7, moves: MOVES}), plan);
  assert.notDeepEqual(planSession({seed: 8, moves: MOVES}).goals, plan.goals);
  assert.deepEqual(makePersona(7), plan.persona);
});

test('a plan has 6 to 10 goals, each move once, numbered, with its pair', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const {goals} = planSession({seed, moves: MOVES});
    assert.ok(goals.length >= 6 && goals.length <= 10, `seed ${seed}: ${goals.length} goals`);
    assert.equal(new Set(goals.map(goal => `${goal.group}: ${goal.label}`)).size, goals.length, 'a move twice');
    assert.deepEqual(goals.map(goal => goal.n), goals.map((_, i) => i + 1));
    assert.deepEqual(goals.map(goal => goal.pair), pairsOf(goals));
    assert.ok(goals[0].pair.startsWith('start → '));
  }
});

test('two fixed seeds differ in at least half of their pairs', () => {
  const pairs = [[11, 12], [101, 202], [3, 4], [50, 51]];
  for (const [a, b] of pairs) assert.ok(apart(planSession({seed: a, moves: MOVES}), planSession({seed: b, moves: MOVES})) >= 0.5, `seeds ${a} and ${b}`);
});

test('a week of sessions: every day at least half new pairs against the last seven', () => {
  let coverage = [];
  for (let day = 1; day <= 20; day++) {
    const plan = planSession({seed: 1000 + day, moves: MOVES, coverage});
    assert.ok(plan.newShare >= MIN_NEW, `day ${day}: only ${plan.newShare} new`);
    assert.equal(plan.newShare, Number(newShare(pairsOf(plan.goals), coverage).toFixed(3)));
    coverage = recordSession(coverage, plan);
  }
  assert.equal(coverage.length, WINDOW);
});

test('the same moves in the same order as a past session are not new; a new order is', () => {
  const a = planSession({seed: 5, moves: MOVES}), coverage = recordSession([], a);
  assert.equal(newShare(pairsOf(a.goals), coverage), 0);
  const reversed = pairsOf([...a.goals].reverse());
  assert.ok(newShare(reversed, coverage) >= 0.8, 'the reverse order walks other pairs');
  assert.equal(newShare([], coverage), 1);
});

test('an area whose code changed always gets a goal', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const plan = planSession({seed, moves: MOVES, changed: ['Focus', 'Settings']});
    for (const area of ['Focus', 'Settings']) assert.ok(plan.goals.some(goal => goal.group === area), `seed ${seed}: no ${area} goal`);
    assert.deepEqual(plan.changedAreas, ['Focus', 'Settings']);
  }
  assert.deepEqual(planSession({seed: 1, moves: MOVES, changed: ['Nowhere']}).changedAreas, [], 'an area the app does not have is ignored');
});

test('a small vocabulary still makes a plan, and reports the share honestly when half cannot be new', () => {
  const few = MOVES.slice(0, 3);
  assert.equal(planSession({seed: 1, moves: few}).goals.length, 3);
  // Two moves, every pair they can make already walked (both orders): MIN_NEW is unreachable, so the plan must say so with the real share.
  const two = MOVES.slice(0, 2), seen = [{pairs: pairsOf(two)}, {pairs: pairsOf([...two].reverse())}];
  const again = planSession({seed: 1, moves: two, coverage: seen});
  assert.ok(again.newShare < MIN_NEW, `it says ${again.newShare}, not a share it did not reach`);
  assert.equal(again.newShare, Number(newShare(pairsOf(again.goals), seen).toFixed(3)));
});

test('the coverage record keeps the last seven sessions, oldest dropped', () => {
  let coverage = [];
  for (let seed = 1; seed <= 10; seed++) coverage = recordSession(coverage, planSession({seed, moves: MOVES}));
  assert.deepEqual(coverage.map(session => session.seed), [4, 5, 6, 7, 8, 9, 10]);
});

test('a person is fictional, complete and different by seed; every CV shape builds', () => {
  const people = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const person = makePersona(seed);
    assert.match(person.email, /^[a-z.]+@example\.test$/);
    assert.ok(person.name && person.country && person.language && person.role && person.place && person.strategy && person.languages.length);
    assert.ok(person.cv.fileName);
    assert.ok(person.cv.text.includes(person.name.split(' ')[0]), `seed ${seed}: the CV does not name the person`);
    people.add(`${person.name}/${person.cv.shape}/${person.cv.fileName}`);
  }
  assert.ok(people.size >= 20, `only ${people.size} different people in 60 seeds`);
  for (const shape of Object.keys(CV_SHAPES)) assert.equal(makePersona(3, {shape}).cv.shape, shape);
});

test('the CV shapes that broke the app are in the data: heading lines, a table, no summary, many languages, a gap, another currency, very short, very long', () => {
  const lines = shape => makePersona(2, {shape}).cv;
  assert.deepEqual(lines('headingLines').headingLines.sort(), ['Education', 'Experience', 'Languages', 'Summary']);
  assert.ok(lines('table').lines.some(line => line.startsWith('|---')));
  assert.equal(lines('noSummary').headingLines.includes('Summary'), false);
  assert.ok(/Dutch .*Arabic/.test(lines('manyLanguages').text));
  assert.match(lines('gapYears').text, /Career break/);
  assert.match(lines('foreignSalary').text, /Expected salary: 41,000 (USD|EUR)/);
  assert.ok(lines('veryShort').lines.length <= 2);
  assert.ok(lines('veryLong').lines.length > 150);
});

test('every CV shape declares exactly the heading lines it emits (a section name alone on a line)', () => {
  for (const name of Object.keys(CV_SHAPES)) {
    const {lines, headingLines} = makePersona(4, {shape: name}).cv;
    for (const heading of headingLines) assert.ok(lines.includes(heading), `${name}: declares "${heading}" but does not emit it`);
    const bare = lines.filter(line => /^(Summary|Experience|Education|Languages|Skills|Profile)$/.test(line));
    assert.deepEqual([...new Set(bare)].sort(), [...headingLines].sort(), `${name}: a heading line is emitted but not declared`);
  }
});

test('the moves come from the app: a job entry folds into one, an unsafe or queue entry is dropped, a repeat is one', () => {
  const entries = [
    {group: 'Go to', label: 'Open Jobs'}, {group: 'Go to', label: 'Open Jobs'},
    {group: 'Jobs', label: 'Open job page: SRE · Acme'}, {group: 'Jobs', label: 'Open job page: Cook · Beta'}, {group: 'Jobs', label: 'Open documents: SRE · Acme'},
    {group: 'Actions', label: 'Remove Find jobs from the queue'}, {group: 'Profile', label: 'Delete my account'}, {group: 'Strategy', label: 'Tune my strategy'}, {group: '', label: 'Orphan'},
  ];
  assert.deepEqual(movesFromPalette(entries), [
    {group: 'Go to', label: 'Open Jobs'}, {group: 'Jobs', label: 'Open job page'}, {group: 'Jobs', label: 'Open documents'}, {group: 'Strategy', label: 'Tune my strategy'}]);
  assert.equal(poolOf(entries).length, 4 + OWN_MOVES.length, 'the own moves are added once each, "Quit and reopen" included');
  assert.equal(poolOf([...entries, OWN_MOVES[0]]).length, 4 + OWN_MOVES.length, 'a move the app also lists is one');
});
