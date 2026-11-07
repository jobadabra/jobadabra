// The AI user agent's day plan, person and moves (lib/agent-plan.mjs, agent-persona.mjs, agent-moves.mjs): replayable from a seed, different every day, never repeating the last week's order, always covering an area that changed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LANGUAGE_LABEL, OTHER_LANGUAGES, OWN_MOVES, languageGoal, movesFromPalette, poolLabel, poolOf, withLanguage} from '../../lib/agent-moves.mjs';
import {CV_SHAPES, makePersona} from '../../lib/agent-persona.mjs';
import {LANGUAGE_EVERY, MAX_LANES, MIN_NEW, WINDOW, laneOf, laneSeed, languageDue, languageOf, lanePool, newShare, pairsOf, pendingGoals, planSession, recordSession} from '../../lib/agent-plan.mjs';

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

test('a plan has 3 to 4 goals (what a night\'s budget pays for), each move once, numbered, with its pair', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const {goals} = planSession({seed, moves: MOVES});
    assert.ok(goals.length >= 3 && goals.length <= 4, `seed ${seed}: ${goals.length} goals`);
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

// Why (7 Nov 2026, pz, owner via mac-50: "Add a new goal to test the multi langauge"): the language goal is drawn at least every LANGUAGE_EVERY nights, in a seed-picked language, and comes back to the pool after a night that could not finish it.
const WITH_LANGUAGE = [...MOVES, {group: 'App', label: LANGUAGE_LABEL}];
const walked = {pairs: [`start → App: ${LANGUAGE_LABEL}`]};
const languageGoalOf = plan => plan.goals.find(goal => goal.group === 'App' && goal.label.startsWith('Read the app in '));

test('a night with no language goal in the two before it carries one; one in either of them does not need it', () => {
  assert.equal(LANGUAGE_EVERY, 3);
  assert.equal(languageDue([]), true);
  assert.equal(languageDue([walked, {pairs: []}, {pairs: []}]), true);   // three nights ago: due again
  assert.equal(languageDue([{pairs: []}, walked, {pairs: []}]), false);
  assert.equal(languageDue([{pairs: []}, {pairs: []}, walked]), false);
  for (let seed = 1; seed <= 40; seed++) assert.ok(languageGoalOf(planSession({seed, moves: WITH_LANGUAGE})), `seed ${seed}: due and missing`);
});

test('the goal names the night\'s language from the seed, keeps the pool\'s pair, and is replayable', () => {
  const names = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const plan = planSession({seed, moves: WITH_LANGUAGE}), goal = languageGoalOf(plan);
    assert.equal(goal.label, languageGoal(languageOf(seed)));
    assert.ok(goal.pair.endsWith(`→ App: ${LANGUAGE_LABEL}`), goal.pair);
    assert.deepEqual(planSession({seed, moves: WITH_LANGUAGE}), plan);
    names.add(languageOf(seed));
  }
  assert.deepEqual([...names].sort(), Object.keys(OTHER_LANGUAGES).sort(), 'every language comes up');
  assert.match(languageGoal('de'), /"Deutsch" in the Language dropdown.*English word.*the test puts the app back in English/);
});

test('without its pool move (a pool of only the palette) nothing is forced, and a queued language goal matches the pool again', () => {
  assert.equal(languageGoalOf(planSession({seed: 3, moves: MOVES})), undefined);
  assert.equal(poolLabel(languageGoal('ru')), LANGUAGE_LABEL);
  assert.equal(poolLabel('Reload the window'), 'Reload the window');
  const session = {summary: {goals: [{n: 1, group: 'App', label: languageGoal('fr'), verdict: 'could-not-finish'}]}, completed: []};
  assert.deepEqual(pendingGoals(session), [{group: 'App', label: LANGUAGE_LABEL}]);
});

test('a palette entry that needs a login-gated address and a browser tab is not a goal the persona is given', () => {
  const moves = movesFromPalette([{group: 'Actions', label: 'Read this board'}, {group: 'Strategy', label: 'Tune my strategy'}]);
  assert.deepEqual(moves.map(move => move.label), ['Tune my strategy']);
});

test('the night\'s pool is the palette plus the language move, and a language goal worked tonight leaves the queue', () => {
  const night = withLanguage(movesFromPalette([{group: 'Strategy', label: 'Tune my strategy'}]));
  assert.deepEqual(night.map(move => move.label), ['Tune my strategy', LANGUAGE_LABEL]);
  assert.equal(withLanguage(night).length, 2, 'added once');
  for (let seed = 1; seed <= 20; seed++) assert.ok(planSession({seed, moves: night, count: 2}).goals.some(goal => goal.label.startsWith('Read the app in ')), `seed ${seed}`);
  const worked = {summary: {goals: [{n: 1, group: 'App', label: languageGoal('it'), verdict: 'worked'}]}, completed: [1]};
  assert.deepEqual(pendingGoals(worked, [{group: 'App', label: LANGUAGE_LABEL}]), [], 'not queued again');
});

// Owner, 7 Nov 2026, via mac-50: "several AI persona at the same time, each one on different paths/goals".
const POOL = withLanguage(MOVES.concat(Array.from({length: 24}, (_, i) => ({group: 'Extra', label: `Extra move ${i + 1}`}))));   // 53 moves, about 13 to a lane
const goalsOf = plan => plan.goals.map(goal => goal.pair.split(' → ').pop());

test('lanes of one seed never share a goal, even when their palettes differ by a move', () => {
  for (const seed of [1, 7, 20261107, 20261108, 99]) {
    const lanes = [1, 2, 3, 4].map(lane => planSession({seed, moves: POOL.filter((_, i) => i !== lane * 7), lane}));   // each lane's app shows or hides a different ⌘K entry
    const keys = lanes.flatMap(goalsOf);
    assert.equal(new Set(keys).size, keys.length, `seed ${seed}: a goal in two lanes: ${keys.join(' | ')}`);
    for (const plan of lanes) assert.ok(plan.goals.length >= 3 && plan.goals.length <= 4, `${plan.goals.length} goals`);
  }
});

test('a lane draws only from its own part of the pool, the same whatever order the palette lists it in', () => {
  const part = lane => lanePool(POOL, 7, lane).map(move => `${move.group}: ${move.label}`).sort();
  assert.deepEqual(lanePool([...POOL].reverse(), 7, 2).map(move => `${move.group}: ${move.label}`).sort(), part(2));
  assert.equal([1, 2, 3, 4].flatMap(part).length, POOL.length, 'every move falls to exactly one lane');
  assert.ok([1, 2, 3, 4].every(lane => part(lane).length >= 3), 'every lane has enough moves to plan 3 goals (the split is by hash, so uneven: 7 to 22 here)');
});

test('a lane is replayable from its seed and lane, has its own seed and person, and the night is unchanged', () => {
  const a = planSession({seed: 7, moves: POOL, lane: 2});
  assert.deepEqual(planSession({seed: 7, moves: POOL, lane: 2}), a);
  assert.equal(a.seed, laneSeed(7, 2));
  assert.notDeepEqual(a.persona, planSession({seed: 7, moves: POOL, lane: 3}).persona);
  assert.deepEqual(planSession({seed: 7, moves: POOL, lane: 0}), planSession({seed: 7, moves: POOL}), 'lane 0 is a night');
});

test('a lane whose part of the pool is too thin fails loudly, and the lane input takes only 1 to MAX_LANES', () => {
  assert.throws(() => planSession({seed: 7, moves: MOVES.slice(0, 5), lane: 1}), /fewer than 3: start the batch with another seed/);
  assert.deepEqual(['', '1', '4', undefined].map(laneOf), [0, 1, 4, 0]);
  for (const bad of ['0', '5', '1.5', 'two', '-1', ' 1', '01x']) assert.throws(() => laneOf(bad), /AGENT_LANE must be/, bad);
  assert.equal(MAX_LANES, 4);
});
