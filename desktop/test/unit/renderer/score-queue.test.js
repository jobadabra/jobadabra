// The scoring queue after a Find jobs run, as the window keeps it (owner, 11 Nov 2026, asked via AskUserQuestion: "One by one, row stays (Recommended)"; on the
// picture: "Yes, build it (Recommended)"; "Keep 60, rest show 'Score' (Recommended)"): the engine's own lines say who is queued and who is scored now, each
// unscored row reads its place from that one state, and the state always clears when the run ends. Also the two rules of when the app starts the queue.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {heldOrder, queuePlace, releaseOrder, scoreQueue, scoreQueueLine} from '../../../renderer/pages/score-queue.js';
import {queueMax, waitingOf, SCORE_QUEUE_END} from '../../../lib/pipeline-tasks.js';
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

test('the queue\'s command scores and nothing else, and its end sends no second notification', () => {
  const storage = {settings: () => ({aiEngine: 'claude-code'}), secret: name => (name === 'ANTHROPIC_API_KEY' ? 'k' : '')};
  const args = scoreQueueArgs(storage, 52);
  assert.deepEqual(args.slice(0, 4), ['src', 'daily', '--mode', 'score']);
  assert.equal(args[args.indexOf('--score-max') + 1], '52');
  assert.ok(!args.includes('--send') && !args.includes('--first-jobs') && !args.includes('--enrich-max'), args.join(' '));
  assert.equal(notice({id: 1, kind: 'today', ok: true, scoreQueue: true}), null);
});
