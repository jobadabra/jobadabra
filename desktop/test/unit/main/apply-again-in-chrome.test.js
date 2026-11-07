// The owner's HYPE session (7 Nov 2026): after the app was updated and restarted, the job's old hidden-browser run was a finished hand-off ("The app was closed ..."); pressing Apply in Chrome
// reopened a tab INTO that same session, so one card showed two truths (header: "Chrome tab open for 3m 51s", card: "The page is closed", "in Jobadabra's browser").
// Pressing Apply again must start a new session whichever mode runs it (#3251 did it for the hidden-browser path only). The real store and controller; terminals as lib/terminals.js behaves.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';
import {createBackgroundApplyStore} from '../../../lib/background-apply-store.js';
import {applyOne, start} from '../../../lib/apply.js';

const url = 'https://jobs.example.test/captain';
const NOW = Date.parse('2026-11-07T00:29:00Z');

function world({stored, events = []}) {
  const app = {id: 'app', url, stage: 'Kit ready'}, sections = new Map([['Background Apply', JSON.stringify({version: 1, session: 'old', mode: 'fill', chosenAt: 'c0', state: 'needs_user_handoff', owner: 'o1', manualOverride: true, ...stored})]]);
  const call = async (_storage, entity, method, args) => {
    if (entity === 'applications' && method === 'get') return app;
    if (entity === 'applications' && method === 'section') return sections.get(args.name) || '';
    if (entity === 'applications' && method === 'set_section') { sections.set(args.name, args.markdown); return null; }
    if (entity === 'events' && method === 'list') return events;
    throw new Error(`unexpected ${entity}.${method}`);
  };
  const records = new Map([['old', {id: 'old', kind: 'form', url, outcome: '', startedAt: '2026-11-05T10:00:00Z', background: {mode: 'fill', state: 'needs_user_handoff', reason: stored.reason, manualOverride: true}}]]);
  const terminals = {list: () => [...records.values()], byUrl: u => [...records.values()].filter(r => r.url === u).pop() || null, record: id => records.get(id) || null, report: () => {}, remove: id => records.delete(id),
    startForm: item => [...records.values()].find(r => r.url === item.url && r.kind === 'form' && !r.outcome) || (records.set(item.id, {...item, kind: 'form', outcome: ''}), records.get(item.id))};
  const closed = [];
  const controller = createBackgroundApplyController({}, {store: createBackgroundApplyStore({}, {call, now: () => NOW, realNow: () => NOW, uuid: () => 'attempt'}), uuid: () => 'x', config: () => ({mode: 'fill', chosenAt: 'c1'}), terminals,
    started: NOW - 1000, stop: () => false, browser: {ready: () => true, start: async () => ({owner: 'o1'}), closeSession: async id => { closed.push(id); return true; }}, reader: {busy: () => false, take: () => null, takeEnded: () => []}, port: 1, token: () => 'fictional', notify: () => {}, log: () => {}});
  return {records, terminals, controller, closed, sections};
}
// Owner, 7 Nov 2026: "The app was closed" on a job whose app he never closed: the update restarted it. The first start of a new version says so; a plain quit keeps "closed".
test('a job held while the app updated is handed over with the update\'s words, a plain quit with "closed"; both start afresh on the next Apply', async () => {
  for (const [updated, reason, words] of [[true, 'app_updated', /updated and restarted/], [false, 'app_closed', /was closed/]]) {
    const notes = [], w = world({stored: {state: 'filling', manualOverride: false, reason: ''}});
    const controller = createBackgroundApplyController({}, {store: createBackgroundApplyStore({}, {call: async (_s, entity, method, args) => {
      if (entity === 'applications' && method === 'get') return {id: 'app', url, stage: 'Kit ready'};
      if (entity === 'applications' && method === 'section') return w.sections.get(args.name) || '';
      if (entity === 'applications' && method === 'set_section') { w.sections.set(args.name, args.markdown); return null; }
      if (entity === 'events') return [];
      throw new Error(entity);
    }, now: () => NOW, realNow: () => NOW, uuid: () => 'attempt'}), terminals: w.terminals, config: () => ({mode: 'fill', chosenAt: 'c1'}), started: NOW, stop: () => false,
    browser: {ready: () => true, start: async () => ({owner: 'o1'}), closeSession: async () => true}, reader: {busy: () => false, take: () => null, takeEnded: () => []}, port: 1, token: () => 'fictional', notify: (...args) => notes.push(args), log: () => {}});
    if (updated) controller.markUpdatedStart();
    assert.deepEqual(await controller.sweepInterrupted(), ['old'], reason);
    assert.equal(w.records.get('old').background.reason, reason);
    assert.match(notes[0][1], words, reason);
    assert.equal(await controller.releaseEnded(url), true, `${reason}: the finished run starts afresh when applied to again`);
  }
});

const press = ({terminals, controller}) => applyOne({}, url, {title: 'Captain'}, {open: () => ({on() {}, unref() {}}), term: terminals, run: async () => '', id: () => 'newtab01', focus: async () => {}, release: u => controller.releaseEnded(u)});

test('Apply in Chrome over a run the app quit or updated away starts a new session; the ended one leaves the list and its hidden tab closes', async () => {
  for (const reason of ['app_closed', 'stopped', 'cancelled']) {
    const w = world({stored: {reason}});
    const result = await press(w);
    assert.equal(result.ok, true, reason);
    assert.equal(result.session.id, 'newtab01', `${reason}: a new session, not the old one`);
    assert.deepEqual([...w.records.keys()], ['newtab01'], `${reason}: the ended session left the list`);
    assert.equal(w.records.get('newtab01').background, undefined, `${reason}: no hidden-browser record on the Chrome session`);
    assert.deepEqual(w.closed, ['old'], reason);
  }
});

test('a hand-off that stays with the person (a bot check, an unknown submit) keeps its session: Apply in Chrome reopens only the tab', async () => {
  for (const stored of [{reason: 'captcha_runtime'}, {reason: 'stopped', attempt: 'a1'}]) {
    const w = world({stored});
    const result = await press(w);
    assert.equal(result.session.id, 'old', JSON.stringify(stored));
    assert.deepEqual([...w.records.keys()], ['old']);
    assert.deepEqual(w.closed, []);
  }
});

// Review of the fix (7 Nov 2026): "Apply to N jobs" in Chrome mode started its sessions without asking the rule, so an ended hidden-browser run was still reused there.
test('the Apply-to-N batch in Chrome mode releases an ended hidden-browser run before its session starts', async () => {
  const w = world({stored: {reason: 'stopped'}}), released = [];
  const jobs = [{url: `${url}#top`, status: 'unreviewed', fit: 80, title: 'Captain', company: 'A', kit: true}];
  const result = await start({}, {n: 1, mode: 'chrome'}, () => ({unref() {}}), async () => ({jobs}), undefined, undefined, null, () => {}, {focus: async () => {}, release: async job => { released.push(job); return w.controller.releaseEnded(job); }});
  assert.deepEqual(released, [url], 'asked for the job address without its #fragment');
  assert.equal(w.records.has('old'), false, `the ended session left the list (${JSON.stringify(result)})`);
});

// Review of the fix: a poll can reach a held job before the start-up sweep; the update's words must not depend on which comes first.
test('once the start is marked as an update, a hand-over by any reader says "updated"', async () => {
  const w = world({stored: {state: 'filling', manualOverride: false, reason: ''}});
  w.controller.markUpdatedStart();
  await w.controller.sweepInterrupted();
  assert.equal(w.records.get('old').background.reason, 'app_updated');
});
