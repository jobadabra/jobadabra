// Layer 3 (Node + the real engine, no window): a hidden application's whole life, and what every screen says at each step through the one label (renderer/session-state.js sessionLabel):
// the Sessions list and its log header, the dock's bucket and the live card's pill.
// Why (8 Nov 2026, owner: "Yes, build it (Recommended)", sketch https://claude.ai/artifact/GvEcS5F6Z5Q5Zh7NPM8nZj): the twin showed "Filling" for a dead run, "Form closed" over endings
// and "queued" for a job already in the person's browser; the unit tests of each part passed with fakes. Here the run's state is the real store's (an Application section written by the engine),
// the controller and the session list are the app's own; only the hidden browser is a stand-in (it starts nothing). Submit is never pressed: no step here reaches a sending button.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {clocked, at} from '../../e2e/lib/test-clock.mjs';
import {startEngineKit} from './engine-kit.mjs';
import {createBackgroundApplyController} from '../../lib/background-apply-controller.js';
import {createBackgroundApplyStore} from '../../lib/background-apply-store.js';
import * as terminals from '../../lib/terminals.js';
import {dockBucket, sessionLabel, tabClosed} from '../../renderer/session-state.js';
import {liveCard} from '../../renderer/live-card.js';

let kit;
before(async () => { kit = await startEngineKit({ai: false}); });
after(async () => { await kit?.close(); });

const CLOSED = ['Form closed', 'neutral'];
// Chrome reports in and shows no tab at all, the harshest real tab report: the app's own rule (tabClosed) decides what is gone; a hidden run never has a tab to lose.
const NO_TABS = {known: true, ids: [], unsure: []};
const gone = item => tabClosed(item, NO_TABS, true);
const config = () => ({mode: 'fill', chosenAt: '2026-11-08T07:00:00Z'});
const job = slug => ({url: `https://jobs.example.test/life/${slug}`, title: 'Site Reliability Engineer', company: `Life ${slug}`});
// The hidden browser's stand-in: no page, no extension; it only answers the controller's calls.
const browser = () => ({ready: () => true, start: async () => ({owner: 'o1', port: 1}), closeSession: async () => true, pageSocket: async () => null});

/** What the screens say for this application now: [list label, dock bucket, live card pill], read from the app's own session record. */
function screens(url) {
  const item = terminals.list().filter(entry => entry.url === url).pop();
  assert.ok(item, `no session for ${url}`);
  return [sessionLabel(item, {tab: gone(item) ? CLOSED : null})[0], dockBucket(item, gone), liveCard(item.background || {}, null, {cancelling: !!item.cancelling}).pill[0]];
}

test('a hidden application through queued, filling, a dead end, a new run, Stop and Open in my browser: every screen says the same at each step', {timeout: 140_000}, clocked(120_000, async () => {
  const store = createBackgroundApplyStore(kit.storage);
  const controller = createBackgroundApplyController(kit.storage, {store, browser: browser(), terminals, config, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const one = job('one'), two = job('two');
  for (const each of [one, two]) await kit.data('applications', 'create', {job: each, stage: 'Kit ready'});
  const sync = () => controller.handle({action: 'poll', owner: 'o1'});   // the hidden browser's extension asks for work: the controller claims the queued run

  at('queued');
  const queued = await controller.enqueue([one], 'fill');
  assert.equal(queued.ok, true, queued.error);
  assert.deepEqual(screens(one.url), ['Queued', 'waiting', 'Queued'], 'queued: the hidden run\'s own state, whatever a tab says');

  at('filling');
  await sync();
  assert.deepEqual(screens(one.url), ['Filling', 'active', 'Filling']);

  at('dead end');
  const session = queued.sessions[0];
  assert.equal((await controller.deadEnd({session, why: 'no-form'}))?.reason, 'no_form');
  assert.deepEqual(screens(one.url), ['Needs you', 'needs', 'Needs you'], 'the twin\'s Lufthansa: no more "Filling" after the dead end');

  at('apply again');
  const again = await controller.enqueue([one], 'fill');
  assert.deepEqual(again.outcomes.map(item => item.status), ['started'], 'a dead end is a finished hand-off: applying again starts a new run');
  assert.notEqual(again.sessions[0], session);
  assert.deepEqual(screens(one.url), ['Queued', 'waiting', 'Queued']);

  at('stop');
  await sync();
  assert.equal((await controller.stopOne(again.sessions[0]))?.reason, 'stopped');
  assert.deepEqual(screens(one.url), ['Needs you', 'needs', 'Needs you'], 'Stop hands the run over, and no closed tab hides it');

  at('open in my browser');
  const other = await controller.enqueue([two], 'fill');
  await sync();
  assert.equal((await controller.handOver(other.sessions[0], async () => null)).ok, true);
  assert.deepEqual(screens(two.url), ['Needs you', 'needs', 'Needs you']);
  const glock = await controller.enqueue([two], 'fill');
  assert.deepEqual(glock.outcomes.map(item => [item.status, item.reason]), [['busy', 'Already open in your browser: finish it there.']], 'the twin\'s GLOCK: never "queued" again');
  assert.equal(glock.ok, false, 'nothing started');
}));
