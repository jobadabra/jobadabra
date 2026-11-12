// The scoring queue after a Find jobs run, as the window keeps it (owner, 11 Nov 2026, asked via AskUserQuestion: "One by one, row stays (Recommended)"; on the
// picture: "Yes, build it (Recommended)"; "Keep 60, rest show 'Score' (Recommended)"): the engine's own lines say who is queued and who is scored now, each
// unscored row reads its place from that one state, and the state always clears when the run ends. Also the two rules of when the app starts the queue.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkQueue, heldOrder, queuePlace, releaseOrder, scoreQueue, scoreQueueLine} from '../../../renderer/pages/score-queue.js';
import {queueMax, waitingOf, waitsOf, SCORE_QUEUE_END} from '../../../lib/pipeline-tasks.js';
import {scoreQueueArgs} from '../../../lib/pipeline-args.js';
import {notice} from '../../../lib/run-history.js';

const start = () => scoreQueueLine('Score queue: {"queue": ["a", "b", "c", "d", "e", "f"], "left": 166}');

test('the engine\'s line starts the queue: every job in it is queued, in its order, and the bar counts from 0', () => {
  scoreQueueLine(SCORE_QUEUE_END);
  assert.equal(scoreQueue(), null, 'no queue before the line');
  assert.equal(start(), true);
  assert.deepEqual(scoreQueue(), {total: 6, done: 0, left: 166});
  assert.deepEqual(['a', 'c', 'f'].map(queuePlace), [{state: 'queued', place: 1}, {state: 'queued', place: 3}, {state: 'queued', place: 6}]);
  assert.equal(queuePlace('zz'), null, 'a job past the queue has no place: its row offers Score once the queue ended');
});

test('a round moves its jobs to Scoring, the ones behind move up, the ones before are done', () => {
  start();
  scoreQueueLine('Scoring now: a,b');
  assert.deepEqual([queuePlace('a'), queuePlace('b'), queuePlace('c')], [{state: 'scoring'}, {state: 'scoring'}, {state: 'queued', place: 1}]);
  scoreQueueLine('Scoring now: c,d');
  assert.equal(queuePlace('a'), null, 'asked in an earlier round: its number is on its way into the list');
  assert.deepEqual([queuePlace('d'), queuePlace('e')], [{state: 'scoring'}, {state: 'queued', place: 1}]);
  assert.deepEqual(scoreQueue(), {total: 6, done: 2, left: 166});
});

test('the queue clears when the run ends, however it ended, and other lines change nothing', () => {
  start();
  for (const line of ['Scored 2 of 4 job(s)', 'Job Matches: 2 created, 0 updated (so far)', 'Score queue: not json', 'Scoring now:']) assert.equal(scoreQueueLine(line), false, line);
  assert.deepEqual(scoreQueue(), {total: 6, done: 0, left: 166});
  assert.equal(scoreQueueLine(SCORE_QUEUE_END), true);
  assert.equal(scoreQueue(), null);
  assert.equal(queuePlace('a'), null);
  assert.equal(scoreQueueLine('Score queue: {"queue": [], "left": 0}'), true, 'nothing waited: no queue is shown');
  assert.equal(scoreQueue(), null);
});

test('rows keep their place while scores land, until the person re-sorts', () => {
  scoreQueueLine(SCORE_QUEUE_END);
  releaseOrder();
  const before = [{url: 'x', fit: 80}, {url: 'y', fit: null}, {url: 'z', fit: null}];
  assert.equal(heldOrder(before), before, 'no queue: the list is as sorted');
  start();
  assert.deepEqual(heldOrder(before).map(row => row.url), ['x', 'y', 'z']);
  const scored = [{url: 'z', fit: 91}, {url: 'new', fit: 85}, {url: 'x', fit: 80}, {url: 'y', fit: null}];   // z got 91: sorted by fit it would jump to the top
  assert.deepEqual(heldOrder(scored).map(row => row.url), ['x', 'y', 'z', 'new'], 'z stays third; a row not listed then goes after');
  scoreQueueLine(SCORE_QUEUE_END);
  assert.deepEqual(heldOrder(scored).map(row => row.url), ['x', 'y', 'z', 'new'], 'the end of the queue moves nothing either');
  releaseOrder();
  assert.deepEqual(heldOrder(scored).map(row => row.url), ['z', 'new', 'x', 'y'], 'the sort menu sorts again');
});

// Why (Gitar on #3843): a queue whose end line never reached the window left rows Queued and "Score" unavailable, and the held order sent a new search's jobs to the bottom.
test('a new search ends the queue in the window and gives the list back its own order', () => {
  scoreQueueLine(SCORE_QUEUE_END);
  releaseOrder();
  assert.equal(scoreQueueLine('Searching job boards and employer sites'), false, 'no queue, no held order: nothing to redraw');
  const before = [{url: 'x', fit: 80}, {url: 'y', fit: null}];
  start();
  heldOrder(before);
  scoreQueueLine('Scoring now: a,b');
  assert.equal(scoreQueueLine('Searching job boards and employer sites'), true, 'the queue was stopped for the search: its end line may never come');
  assert.equal(scoreQueue(), null);
  assert.equal(queuePlace('c'), null, 'no row stays Queued');
  const after = [{url: 'fresh', fit: 95}, {url: 'x', fit: 80}, {url: 'y', fit: null}];
  assert.equal(heldOrder(after), after, 'the new search\'s jobs take the order the person chose');
});

// Why (Gitar on #3843): the queue's row is a list refresh (kind 'today') like a visits read's; as the same task it joined a running one and never ran.
test('the queue is its own task: it waits behind a list refresh, it does not join one', async () => {
  const {tracked} = await import('../../../lib/pipeline-queue.js');
  const files = {};
  const storage = {readText: name => { if (!(name in files)) throw new Error('none'); return files[name]; }, writeText: (name, text) => { files[name] = text; }, settings: () => ({})};
  const ran = [];
  let free;
  const first = tracked(storage, 'today', 'you', () => {}, async () => { ran.push('visits'); await new Promise(resolve => { free = resolve; }); return {ok: true}; }, null, () => ({}));
  const queue = tracked(storage, 'today', 'you', () => {}, async () => { ran.push('queue'); return {ok: true}; }, null, () => ({scoreQueue: true}), {key: 'score'});
  const again = tracked(storage, 'today', 'you', () => {}, async () => { ran.push('queue again'); return {ok: true}; }, null, () => ({}), {key: 'score'});
  assert.notEqual(queue, first, 'not joined to the visits read');
  assert.equal(again, queue, 'a second press of Score joins the queue already waiting');
  await new Promise(resolve => setTimeout(resolve, 0));
  free();
  assert.equal((await queue).run.scoreQueue, true);
  assert.deepEqual(ran, ['visits', 'queue']);
});

test('the app starts the queue only when a search left found jobs unscored, and never past the run\'s 60', () => {
  assert.equal(waitingOf('⏱ 143 found job(s) wait for the next refresh, to be scored (best places and closest jobs first)'), 143);
  assert.equal(waitingOf('⏱ Time is up for this refresh: 100 job(s) left for the next one (it stops at 2.2 min)'), 100);
  assert.equal(waitingOf('Scored 8 of 8 job(s)'), null);
  assert.equal(queueMax({left: 143, scored: 8, stopped: false, ai: true}), 52, 'the search\'s own scores count toward the 60');
  assert.equal(queueMax({left: 0, scored: 8, stopped: false, ai: true}), 0, 'nothing waits');
  assert.equal(queueMax({left: 143, scored: 60, stopped: false, ai: true}), 0, 'the search made the 60 itself');
  assert.equal(queueMax({left: 143, scored: 8, stopped: true, ai: true}), 0, 'the person stopped the search: nothing goes on by itself');
  assert.equal(queueMax({left: 143, scored: 8, stopped: false, ai: false}), 0, 'no AI, no scores');
});

test('a search that kept jobs to check or postings to read starts the queue too, and the bar counts the check before the scores', () => {
  // Owner, 12 Nov 2026 (asked via AskUserQuestion: "Yes, build it (Recommended)"; "Yes, one bar, a count (Recommended)"): Paris listed 30 jobs, 23 with no posting read, no "jobs left" line: the queue never started.
  assert.equal(waitsOf('Waiting to be checked after this search: 24 job(s) of Job boards found'), true);
  assert.equal(waitsOf('⏱ Time is up (2 min 05 s) for descriptions: 1 round of posting reads waits for the next search'), true);
  assert.equal(waitsOf('⏱ Time is up (2 min 05 s) for job boards: 2 boards wait for the next search'), false);
  assert.equal(queueMax({left: 0, waits: true, scored: 7, stopped: false, ai: true}), 53);
  assert.equal(queueMax({left: 0, waits: true, scored: 7, stopped: true, ai: true}), 0, 'a stopped search starts nothing');
  assert.equal(scoreQueueLine('Check queue: {"waiting": 24, "done": 0}'), true);
  assert.deepEqual(checkQueue(), {waiting: 24, done: 0});
  scoreQueueLine('Check queue: {"waiting": 24, "done": 30}');
  assert.deepEqual(checkQueue(), {waiting: 24, done: 24}, 'never more than waits');
  assert.equal(scoreQueueLine('Check queue: done'), true);
  assert.equal(checkQueue(), null);
  scoreQueueLine('Check queue: {"waiting": 3, "done": 0}');
  assert.equal(scoreQueueLine('Score queue: done'), true, 'the queue ended however it ended: the check clears with it');
  assert.equal(checkQueue(), null);
});

test('the queue\'s command scores and nothing else, and its end sends no second notification', () => {
  const storage = {settings: () => ({aiEngine: 'claude-code'}), secret: name => (name === 'ANTHROPIC_API_KEY' ? 'k' : '')};
  const args = scoreQueueArgs(storage, 52);
  assert.deepEqual(args.slice(0, 4), ['src', 'daily', '--mode', 'score']);
  assert.equal(args[args.indexOf('--score-max') + 1], '52');
  assert.ok(!args.includes('--send') && !args.includes('--first-jobs') && !args.includes('--enrich-max'), args.join(' '));
  assert.equal(notice({id: 1, kind: 'today', ok: true, scoreQueue: true}), null);
});
