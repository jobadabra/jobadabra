// A batch keeps the mode it started with (owner, 7 Nov 2026, #3363: "The batch should continue with the setting it was set once the batch has been started").
// Guard: safety — a Settings change mid-batch must not move a queued item into or out of Full automation; only Stop and Cancel all end it. Tests never submit: the controller is driven with a fake store.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';

const now = Date.parse('2026-11-07T10:00:00Z');
const waiting = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'waiting_to_submit', readyAt: now - 11 * 60000, manualOverride: false};
function poll({saved, stuck = ''}) {
  const handoffs = [];
  const controller = createBackgroundApplyController({}, {
    store: {read: async () => waiting, handoff: async (_url, _id, _owner, reason) => { handoffs.push(reason); return {...waiting, state: 'needs_user_handoff', manualOverride: true, reason}; }},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {}, ...(stuck ? {stuck} : {})}], record: () => null, report: () => {}},
    config: () => saved, now: () => now, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  return controller.handle({action: 'poll', owner: 'o1'}).then(answer => ({answer, handoffs}));
}

test('a Full automation item keeps going when Settings now says Fill: the change applies to the next batch only', async () => {
  const {answer, handoffs} = await poll({saved: {mode: 'fill', chosenAt: 'c2', auto: {waitMin: 10}}});
  assert.deepEqual(handoffs, [], 'no hand-over for a changed Settings mode');
  assert.deepEqual(answer.checks, [{session: 's1'}], 'the elapsed wait still asks for its press, as the batch was started');
});

test('Stop still ends the batch at its next item, whatever Settings says', async () => {
  for (const saved of [{mode: 'auto', chosenAt: 'c1', auto: {waitMin: 10}}, {mode: 'fill', chosenAt: 'c2', auto: {waitMin: 10}}]) {
    const {answer, handoffs} = await poll({saved, stuck: 'stopped'});
    assert.deepEqual(handoffs, ['stopped'], `Stop hands the item to the person (Settings ${saved.mode})`);
    assert.deepEqual(answer.checks, [], 'no press after Stop');
  }
});

// Each batch carries its own mode and its own Full-automation confirmation (owner, 7 Nov 2026: "we can choose a different apply mode every time, for every new batch"; "We don't want to change the settings from the Apply to jobs").
function enqueuer(settings) {
  const queued = [];
  const controller = createBackgroundApplyController({}, {
    store: {queue: async (url, id, mode, config) => { queued.push({url, mode, mode_in_config: config.mode, autoConfirmedAt: config.autoConfirmedAt, linkedinConfirmedAt: config.linkedinConfirmedAt}); return {session: id, mode, state: 'queued'}; }},
    browser: {ready: () => true, start: async () => ({owner: 'o1'})},
    terminals: {list: () => [], byUrl: () => null, startForm: ({id}) => ({id}), record: () => null, report: () => {}},
    config: () => settings, now: () => now, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  return {queued, enqueue: (url, mode, batch) => controller.enqueue([{url: `https://jobs.example.test/${url}`}], mode, batch)};
}
const STAMP = '2026-11-07T09:59:00.000Z';

test('three batches in a row (Fill, Full automation, Fill): each queues in its own mode, Full automation under its own confirmation, Settings never read as changed', async () => {
  const settings = Object.freeze({mode: 'fill', chosenAt: 'c1', autoConfirmedAt: ''});   // frozen: a write would throw
  const {queued, enqueue} = enqueuer(settings);
  assert.equal((await enqueue('a', 'fill', {autoConfirmedAt: ''})).ok, true);
  assert.equal((await enqueue('b', 'auto', {autoConfirmedAt: STAMP})).ok, true);
  assert.equal((await enqueue('c', 'fill', {autoConfirmedAt: ''})).ok, true);
  assert.deepEqual(queued.map(item => [item.mode, item.mode_in_config, item.autoConfirmedAt]), [['fill', 'fill', ''], ['auto', 'auto', STAMP], ['fill', 'fill', '']]);
  assert.deepEqual(settings, {mode: 'fill', chosenAt: 'c1', autoConfirmedAt: ''});
});

test('Full automation for a second batch is refused without its own confirmation: nothing is inherited from the first batch or from Settings\' old stamp', async () => {
  const {queued, enqueue} = enqueuer({mode: 'fill', chosenAt: 'c1', autoConfirmedAt: '2026-10-01T00:00:00.000Z'});   // a stale stamp left in Settings
  assert.equal((await enqueue('a', 'auto', {autoConfirmedAt: STAMP})).ok, true);
  const second = await enqueue('b', 'auto', {autoConfirmedAt: ''});
  assert.equal(second.ok, false);
  assert.match(second.error, /Full automation is off until you confirm it/);
  assert.equal(queued.length, 1, 'only the confirmed batch queued');
});

test('a call with no pick keeps the saved-mode path: Settings\' own confirmation and its refusals', async () => {
  const {queued, enqueue} = enqueuer({mode: 'auto', chosenAt: 'c1', autoConfirmedAt: '2026-11-01T08:00:00.000Z'});
  assert.equal((await enqueue('a', 'auto', null)).ok, true, 'Settings on Full automation, confirmed there');
  assert.equal(queued[0].autoConfirmedAt, '2026-11-01T08:00:00.000Z');
  const mismatch = await enqueue('b', 'fill', null);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /Confirm the saved Apply mode first/);
  const unconfirmed = await enqueuer({mode: 'auto', chosenAt: 'c1', autoConfirmedAt: ''}).enqueue('c', 'auto', null);
  assert.match(unconfirmed.error, /Settings → Apply/);
});

test('a pick still needs a chosen Settings mode: the first-choice gate stays in front of it', async () => {
  const {queued, enqueue} = enqueuer({mode: 'fill', chosenAt: '', autoConfirmedAt: ''});
  assert.match((await enqueue('a', 'fill', {autoConfirmedAt: ''})).error, /Confirm the saved Apply mode first/);
  assert.deepEqual(queued, []);
});

// Gitar on #3409: a live Full automation job in a Fill batch is skipped and said, never a refusal after the batch's other jobs were queued.
test('a Fill batch holding a job that is still queued for Full automation queues the others and says the skipped one', async () => {
  const queued = [];
  const controller = createBackgroundApplyController({}, {
    store: {queue: async (url, id, mode, config) => {
      if (url.endsWith('/a')) throw Object.assign(new Error('This job is already queued for Full automation.'), {code: 'LIVE_AUTO'});
      queued.push(url); return {session: id, mode, state: 'queued'};
    }},
    browser: {ready: () => true, start: async () => ({owner: 'o1'})},
    terminals: {list: () => [], byUrl: () => null, startForm: ({id}) => ({id}), record: () => null, report: () => {}},
    config: () => ({mode: 'fill', chosenAt: 'c1'}), now: () => now, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const result = await controller.enqueue([{url: 'https://jobs.example.test/b'}, {url: 'https://jobs.example.test/a'}], 'fill', {autoConfirmedAt: ''});
  assert.equal(result.ok, true);
  assert.deepEqual(queued, ['https://jobs.example.test/b']);
  assert.match(result.message, /1 job was skipped: it is already queued for Full automation/);
  const only = await controller.enqueue([{url: 'https://jobs.example.test/a'}], 'fill', {autoConfirmedAt: ''});
  assert.equal(only.ok, false);
  assert.match(only.error, /already queued for Full automation/);
});

// Why (14 Nov 2026, owner, plan 4b-1, asked via AskUserQuestion: "In the Full auto confirm (Recommended)"): the batch's "LinkedIn may send" yes reaches each queued item beside its Full automation yes.
test('a Full automation batch carries its own "LinkedIn may send" yes to the store; another mode carries none', async () => {
  const {queued, enqueue} = enqueuer(Object.freeze({mode: 'fill', chosenAt: 'c1', autoConfirmedAt: '', linkedinConfirmedAt: ''}));
  assert.equal((await enqueue('a', 'auto', {autoConfirmedAt: STAMP, linkedinConfirmedAt: STAMP})).ok, true);
  assert.equal((await enqueue('b', 'fill', {autoConfirmedAt: '', linkedinConfirmedAt: STAMP})).ok, true);
  assert.deepEqual(queued.map(item => [item.mode, item.linkedinConfirmedAt]), [['auto', STAMP], ['fill', '']]);
});
