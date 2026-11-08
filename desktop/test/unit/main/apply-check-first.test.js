// A Full automation batch checks its forms first, then the person confirms the split (owner, 7 Nov 2026; spec docs/superpowers/specs/2026-11-07-full-automation-check-first.md).
// Guard: safety — only jobs read as simple forms and seen by the person under Full automation may be queued with the Full automation confirmation; the others never submit; Cancel or a mismatched confirm queues nothing.
// The apply handlers, the real controller and the real background store run here over a fake engine (in memory), a fake hidden browser and a fake form reader: no browser, no Chrome, no submit.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {registerApplyHandlers} from '../../../lib/apply-handlers.js';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';
import {createBackgroundApplyStore} from '../../../lib/background-apply-store.js';
import {HOLD_MS, createCheckFirst} from '../../../lib/apply-check-first.js';
import {splitBatch} from '../../../renderer/apply-split.js';

const here = path.resolve(import.meta.dirname, '../../..');
const STAMP = '2026-11-07T09:59:00.000Z';
const simple = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: ''};
const job = n => ({url: `https://jobs.check-first.example/${n}`, title: `Fictional Analyst ${n}`, company: `Fictional Co ${n}`});
const JOBS = [1, 2, 3, 4, 5].map(job);
// The five reads: three simple forms, one that needs details the person has not saved (a judge-based read), one the light look named a captcha.
const READS = {[JOBS[0].url]: simple, [JOBS[1].url]: simple, [JOBS[2].url]: simple,
  [JOBS[3].url]: {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: false},
  [JOBS[4].url]: {...simple, captcha: true, simple: false, why: 'captcha'}};

function engine() {
  const apps = new Map(), sections = new Map(), events = [];
  JOBS.forEach((item, index) => { apps.set(item.url, {id: `app-${index}`, url: item.url, stage: 'Kit ready'}); sections.set(`app-${index}:📝 Application kit`, '```json\n{"eligible":true,"answers":[]}\n```'); });
  const call = async (_storage, entity, method, args) => {
    if (entity === 'applications' && method === 'get') return apps.get(args.url) || null;
    if (entity === 'applications' && method === 'section') return sections.get(`${args.app_id}:${args.name}`) || '';
    if (entity === 'applications' && method === 'set_section') { sections.set(`${args.app_id}:${args.name}`, args.markdown); return null; }
    if (entity === 'events' && method === 'list') return events.filter(event => !args.kind || event.kind === args.kind);
    if (entity === 'events' && method === 'add') { const row = {...args, id: `e${events.length + 1}`}; events.push(row); return row; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  return {call};
}

function app({settings = {apply: {mode: 'auto', chosenAt: 'c1', autoConfirmedAt: STAMP}}, reads = READS, stored = null, onCancel = () => {}} = {}) {
  const {call} = engine(), opened = [], asked = [];
  const storage = {settings: () => settings};
  const store = createBackgroundApplyStore(storage, {call, now: () => Date.parse('2026-11-07T10:00:00Z')});
  const terminals = {list: () => [], byUrl: () => null, startForm: ({id}) => ({id}), record: () => null, report: () => {}, remove: () => {}};
  const reader = {read: async url => { asked.push(url); return reads[url] ?? null; }, busy: () => false, take: () => null, takeEnded: () => [], cancelAll: () => onCancel()};
  const background = createBackgroundApplyController(storage, {store, terminals, reader, browser: {ready: () => true, start: async () => ({owner: 'o1'}), closeSession: async () => true},
    config: () => ({...settings.apply, auto: {waitMin: 0}}), now: () => Date.parse('2026-11-07T10:00:00Z'), token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const handles = new Map();
  registerApplyHandlers({DEMO: false, background, clock: () => Date.parse('2026-11-07T10:00:00Z'), ...(stored ? {storedCheck: stored} : {}), extensionGate: () => null, allowanceBlock: async () => null, needsNotion: () => null, claudeConsent: async () => true, staleNote: () => '',
    ipcMain: {handle: (name, fn) => handles.set(name, fn)}, log: () => {}, here, storage, toWindow: () => {}, track: () => {}, prepareKitFor: async () => ({}), startClaude: async () => ({}),
    getRecipeReporter: () => null, cloud: {},
    // The batch runner picks the five jobs and hands them to the handler's queue, as lib/apply.js start() does; openInChrome records the jobs it would open.
    applyRunner: {start: async (_storage, options, ...rest) => rest[6].enqueue(JOBS, options.applyMode, {allowIneligible: false}),
      openInChrome: async (_storage, jobs) => { opened.push(...jobs.map(item => item.url)); return {ok: true, outcomes: jobs.map(item => ({url: item.url, status: 'started', reason: ''}))}; }}});
  const ipc = (name, ...args) => handles.get(name)({}, ...args);
  return {ipc, store, opened, asked};
}
const checkAll = async (ipc, check) => { for (const item of check.jobs) await ipc('applyCheckRead', check.plan, item.url); };

test('a 5-job Full automation batch is held, checked, then queued per job: 3 as Full automation with the confirmation, 1 Background and 1 in Chrome that never submit', async () => {
  const {ipc, store, opened, asked} = app();
  const held = await ipc('apply', {n: 5, mode: 'settings', checkFirst: true});
  assert.equal(held.ok, true);
  assert.deepEqual(held.check.jobs.map(item => item.url), JOBS.map(item => item.url), 'the five chosen jobs are held for their check');
  for (const item of JOBS) assert.equal(await store.read(item.url), null, 'nothing is queued while the batch is held');
  await checkAll(ipc, held.check);
  assert.deepEqual(asked, JOBS.map(item => item.url), 'each job was read once');
  const done = await ipc('applyCheckConfirm', held.check.plan, JOBS.slice(0, 3).map(item => item.url));
  assert.equal(done.ok, true, done.error);
  for (const item of JOBS.slice(0, 3)) {
    const state = await store.read(item.url);
    assert.deepEqual([state.mode, state.autoConfirmedAt], ['auto', STAMP], `${item.url} goes automatic under the batch's own confirmation`);
  }
  const fill = await store.read(JOBS[3].url);
  assert.equal(fill.mode, 'fill', 'needs your details: Background · you submit');
  assert.equal(fill.autoConfirmedAt, undefined, 'a Background item carries no Full automation confirmation');
  const proof = {answer: 'ready', step: 'final', submitControl: 'Send', requiredComplete: true, factsOnly: true, safe: true, botCheck: false, signature: 'p1'};
  assert.equal((await store.claim(JOBS[3].url, fill.session, 'o2')).ok, true);
  await store.ready(JOBS[3].url, fill.session, 'o2', proof);
  assert.equal((await store.reserve(JOBS[3].url, fill.session, 'o2', proof, {auto: {waitMin: 0}})).submit, false, 'the store never lets the Background item submit');
  assert.equal(await store.read(JOBS[4].url), null, 'the captcha job is not in the hidden browser');
  assert.deepEqual(opened, [JOBS[4].url], 'the captcha job opens in Chrome for the person');
});

test('Cancel ends the held batch: nothing is queued, and a later confirm of the same batch queues nothing', async () => {
  const {ipc, store, opened} = app();
  const held = await ipc('apply', {n: 5, mode: 'settings', checkFirst: true});
  await ipc('applyCheckRead', held.check.plan, JOBS[0].url);
  await ipc('applyCheckCancel', held.check.plan);
  const late = await ipc('applyCheckConfirm', held.check.plan, [JOBS[0].url]);
  assert.equal(late.ok, false);
  for (const item of JOBS) assert.equal(await store.read(item.url), null);
  assert.deepEqual(opened, []);
});

test('a confirm that raises a job past the app\'s own check queues nothing (a stale or forged list)', async () => {
  for (const seen of [JOBS.map(item => item.url), [...JOBS.slice(0, 3).map(item => item.url), JOBS[3].url]]) {
    const {ipc, store, opened} = app();
    const held = await ipc('apply', {n: 5, mode: 'settings', checkFirst: true});
    await checkAll(ipc, held.check);
    const answer = await ipc('applyCheckConfirm', held.check.plan, seen);
    assert.equal(answer.ok, false, `seen ${seen.length}`);
    assert.match(answer.error, /Nothing was queued/);
    for (const item of JOBS) assert.equal(await store.read(item.url), null);
    assert.deepEqual(opened, []);
  }
});

test('the window may lower a job, never raise it: a simple form the person saw as needing details goes to Background, without the confirmation', async () => {
  const {ipc, store} = app();
  const held = await ipc('apply', {n: 5, mode: 'settings', checkFirst: true});
  await checkAll(ipc, held.check);
  assert.equal((await ipc('applyCheckConfirm', held.check.plan, JOBS.slice(0, 2).map(item => item.url))).ok, true);
  const lowered = await store.read(JOBS[2].url);
  assert.deepEqual([lowered.mode, lowered.autoConfirmedAt], ['fill', undefined]);
  assert.equal((await store.read(JOBS[0].url)).mode, 'auto');
});

test('a check prepared with the kit shows at once: only jobs without one are read live', async () => {
  const {ipc, store, asked} = app({stored: item => (item.url === JOBS[3].url || item.url === JOBS[4].url ? null : simple)});
  const held = await ipc('apply', {n: 5, mode: 'settings', checkFirst: true});
  assert.deepEqual(held.check.jobs.map(item => !!item.read), [true, true, true, false, false], 'each job says whether it still needs a check');
  for (const item of held.check.jobs.filter(entry => !entry.read)) await ipc('applyCheckRead', held.check.plan, item.url);
  assert.deepEqual(asked, [JOBS[3].url, JOBS[4].url], 'only the two without a stored check were read');
  assert.equal((await ipc('applyCheckConfirm', held.check.plan, JOBS.slice(0, 3).map(item => item.url))).ok, true);
  assert.equal((await store.read(JOBS[0].url)).mode, 'auto');
});

test('a dialog pick carries its own Full automation confirmation through the check', async () => {
  const given = STAMP;   // a minute before the handlers' pinned clock: batchConfirmation keeps only a recent stamp
  const {ipc, store} = app({settings: {apply: {mode: 'fill', chosenAt: 'c1', autoConfirmedAt: ''}}});
  const held = await ipc('apply', {n: 5, mode: 'settings', pick: 'auto', autoConfirmedAt: given, checkFirst: true});
  assert.equal(held.ok, true, held.error);
  await checkAll(ipc, held.check);
  assert.equal((await ipc('applyCheckConfirm', held.check.plan, JOBS.slice(0, 3).map(item => item.url))).ok, true);
  assert.deepEqual([(await store.read(JOBS[0].url)).autoConfirmedAt, (await store.read(JOBS[3].url)).mode], [given, 'fill']);
});

test('a read that lands after Cancel is not kept, and Cancel of an unknown batch stops no reads', async () => {
  let release, cancels = 0;
  const check = createCheckFirst({read: () => new Promise(resolve => { release = resolve; }), enqueue: async () => ({ok: true, outcomes: []}), openInChrome: async () => ({ok: true, outcomes: []})});
  const {check: held} = await check.hold([JOBS[0]]);
  const late = check.readOne(held.plan, JOBS[0].url);
  assert.equal(check.cancel(held.plan).held, true);
  release(simple); await late;
  assert.equal(check.splitOf(held.plan), null, 'the batch is gone with its reads');
  assert.equal(check.cancel('no-such-batch').held, false);
  const {ipc} = app({onCancel: () => { cancels++; }});
  await ipc('applyCheckCancel', 'no-such-batch');
  assert.equal(cancels, 0, 'the Jobs page\'s own check goes on');
});

test('the existing Full automation confirmation still decides first: an unconfirmed batch is refused before any form is read or held', async () => {
  const {ipc, asked} = app({settings: {apply: {mode: 'auto', chosenAt: 'c1', autoConfirmedAt: ''}}});
  const answer = await ipc('apply', {n: 5, mode: 'settings', checkFirst: true});
  assert.equal(answer.ok, false);
  assert.match(answer.error, /Full automation is off until you confirm it/);
  assert.equal(answer.check, undefined);
  assert.deepEqual(answer.outcomes.map(item => [item.url, item.status]), JOBS.map(item => [item.url, 'not-started']), 'the same refusal enqueue gives: each job not started');
  assert.deepEqual(asked, []);
});

test('the dialog\'s Full automation batch is held for its check; a Background batch, or a call without checkFirst (the e2e runner proofs), queues at once as before', async () => {
  const auto = await app().ipc('apply', {n: 5, mode: 'settings', checkFirst: true});
  assert.deepEqual(auto.check.jobs.map(item => item.url), JOBS.map(item => item.url), 'Full automation: held, nothing queued yet');
  const direct = app();
  assert.equal((await direct.ipc('apply', {n: 5, mode: 'settings'})).check, undefined);
  assert.equal((await direct.store.read(JOBS[3].url)).mode, 'auto', 'the runner\'s own proofs still start Full automation directly, under its confirmation');
  const {ipc, store} = app({settings: {apply: {mode: 'fill', chosenAt: 'c1', autoConfirmedAt: ''}}});
  assert.equal((await ipc('apply', {n: 5, mode: 'settings', checkFirst: true})).check, undefined);
  assert.equal((await store.read(JOBS[3].url)).mode, 'fill');
});

test('the app matches its own reads once (L2b), so a simple form missing a detail is lowered in the split Confirm checks; a stored match is not asked again', async () => {
  const asked = [], queued = [];
  const withQuestions = {...simple, questions: ['Phone']};
  const check = createCheckFirst({read: async () => withQuestions, stored: async item => (item.url === JOBS[2].url ? {...withQuestions, match: {missing: [], unjudged: 0}} : null),
    match: async items => { asked.push(...items.map(item => item.url)); return {[JOBS[0].url]: {missing: [], unjudged: 0}, [JOBS[1].url]: {missing: [{kind: 'detail', label: 'Phone'}], unjudged: 0}}; },
    enqueue: async (jobs, mode, batch) => { queued.push([mode, jobs.map(item => item.url), batch?.autoConfirmedAt || '']); return {ok: true, outcomes: jobs.map(item => ({url: item.url, status: 'started'}))}; }, openInChrome: async () => ({ok: true, outcomes: []})});
  const {check: held} = await check.hold(JOBS.slice(0, 3), {batch: {autoConfirmedAt: STAMP}});
  for (const item of JOBS.slice(0, 2)) await check.readOne(held.plan, item.url);
  const {reads} = await check.matchAll(held.plan);
  assert.deepEqual(asked, [JOBS[0].url, JOBS[1].url], 'one call, only reads without a match');
  assert.deepEqual(reads[JOBS[1].url].match.missing.map(item => item.label), ['Phone'], 'the window paints from the app\'s matched reads');
  assert.deepEqual(check.splitOf(held.plan).fill.map(entry => entry.job.url), [JOBS[1].url]);
  assert.equal((await check.confirm(held.plan, [JOBS[0].url, JOBS[2].url])).ok, true);
  assert.deepEqual(queued, [['auto', [JOBS[0].url, JOBS[2].url], STAMP], ['fill', [JOBS[1].url], '']]);
  assert.equal(await check.matchAll(held.plan), null, 'an answered batch has nothing to match');
});

test('the split only lowers a job: no read, an unreadable read or not eligible is "none"; nothing reaches auto without a simple-form read', () => {
  const reads = {a: null, b: {unreadable: true, why: 'timeout'}, c: {...simple, eligible: false}, d: {...simple, simple: false, why: 'login'}, e: simple};
  const split = splitBatch(['a', 'b', 'c', 'd', 'e'].map(url => ({url})), url => reads[url]);
  assert.deepEqual(Object.fromEntries(Object.entries(split).map(([group, entries]) => [group, entries.map(entry => entry.job.url)])), {auto: ['e'], fill: [], check: ['d'], none: ['a', 'b', 'c']});
  assert.equal(split.none[1].reason, 'timeout');
  assert.deepEqual(splitBatch([{url: 'c'}], url => reads[url], {allowIneligible: true}).auto.map(entry => entry.job.url), ['c'], 'a batch that allows jobs marked not eligible picked it with that choice');
});

test('a held batch older than the hold window is gone: its confirm queues nothing', async () => {
  let time = 0;
  const queued = [];
  const check = createCheckFirst({read: async () => simple, enqueue: async (jobs, mode) => { queued.push(mode); return {ok: true, outcomes: []}; }, openInChrome: async () => ({ok: true, outcomes: []}), now: () => time});
  const {check: held} = await check.hold([JOBS[0]]);
  await check.readOne(held.plan, JOBS[0].url);
  time += HOLD_MS + 1;
  assert.equal((await check.confirm(held.plan, [JOBS[0].url])).ok, false);
  assert.deepEqual(queued, []);
});
