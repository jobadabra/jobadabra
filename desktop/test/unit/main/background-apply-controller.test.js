// Full automation is refused until the person confirmed it in Settings → Apply: no store write, no browser, no session before that.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';

const touched = [];
const spy = name => (...args) => { touched.push(name); return args; };
const make = (options = {}) => createBackgroundApplyController({}, {
  store: {queue: spy('store.queue')}, browser: {start: spy('browser.start')}, terminals: {list: () => [], byUrl: () => null, startForm: spy('terminals.startForm')},
  config: () => ({mode: 'auto', chosenAt: '2026-10-28T10:00:00Z'}), ...options});

test('Full automation without the person\'s confirmation: no store write, no browser, no session', async () => {
  const result = await make({config: () => ({mode: 'auto', autoConfirmedAt: ''})}).enqueue([{url: 'https://jobs.example.test/a'}], 'auto');
  assert.equal(result.ok, false);
  assert.match(result.error, /off until you confirm it in Settings/);
  assert.deepEqual(touched, []);
});

test('Background automation without the downloaded browser refuses before any store write, session or launch', async () => {
  touched.length = 0;
  const result = await make({config: () => ({mode: 'fill', chosenAt: '2026-10-28T10:00:00Z'}), browser: {ready: () => false, start: spy('browser.start')}})
    .enqueue([{url: 'https://jobs.example.test/b'}], 'fill');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BACKGROUND_BROWSER_MISSING');
  assert.deepEqual(touched, []);
});

test('enqueue applies the batch captured eligibility choice over a later Settings read', async () => {
  const queued = [];
  const controller = createBackgroundApplyController({}, {
    store: {queue: async (...args) => { queued.push(args); return {ok: true, session: 'session1', mode: 'fill', state: 'queued'}; }},
    browser: {ready: () => true, start: async () => ({owner: 'owner'})},
    terminals: {list: () => [], byUrl: () => null, startForm: item => item, record: () => null},
    config: () => ({mode: 'fill', chosenAt: 'chosen', allowIneligible: false}),
    uuid: () => 'session1', token: () => 'fictional', port: 1,
  });
  const result = await controller.enqueue([{url: 'https://jobs.example.test/a'}], 'fill', null, {allowIneligible: true});
  assert.equal(result.ok, true);
  assert.equal(queued[0][3].allowIneligible, true, 'the item stores the batch choice, not a later Settings value');
});

test('registering the apply handlers creates the controller without touching storage paths', () => {
  assert.doesNotThrow(() => createBackgroundApplyController({}, {store: {}}));   // CI #2324: a storage with no path() crashed handler registration
});

test('the live view reaches only a hidden-browser session\'s held tab, never a visible session or an unknown id', async () => {
  const records = {bg: {id: 'bg', background: {}}, visible: {id: 'visible'}}, asked = [];
  const controller = createBackgroundApplyController({}, {store: {}, terminals: {record: id => records[id] || null},
    browser: {pageSocket: async id => { asked.push(id); return `ws://127.0.0.1:9/devtools/page/${id}`; }}});
  assert.equal(await controller.page('bg'), 'ws://127.0.0.1:9/devtools/page/bg');
  assert.equal(await controller.page('visible'), null);
  assert.equal(await controller.page('nobody'), null);
  assert.deepEqual(asked, ['bg'], 'the browser is asked only for the hidden session');
});

test('the controller reads the notifier when it notifies, not when it is created', async () => {
  const hooks = await import('../../../lib/server-hooks.js');
  const record = {id: 's1', url: 'https://jobs.example.test/n', background: {}}, sent = [];
  const controller = createBackgroundApplyController({}, {   // the controller exists before main.js wires the notifier (bot review on #2324)
    store: {handoff: async () => ({mode: 'fill', state: 'needs_user_handoff', reason: 'stopped', session: 's1'})},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {record: () => record, report: () => {}}, config: () => ({}), log: () => {}, token: () => 'fictional', port: 1});
  hooks.setNotifier((...args) => sent.push(args));
  try { await controller.handle({owner: 'o1', session: 's1', action: 'manual', reason: 'stopped'}); }
  finally { hooks.setNotifier(() => {}); }
  assert.equal(sent.length, 1);
});

const held = (state, extra = {}) => {
  const records = {bg: {id: 'bg', url: 'https://jobs.example.test/h', background: {}}, visible: {id: 'visible', url: 'https://jobs.example.test/v'}}, seen = [];
  const controller = createBackgroundApplyController({}, {terminals: {record: id => records[id] || null, report: () => {}}, config: () => ({}), log: () => {}, token: () => 'fictional', port: 1,
    notify: () => {}, store: {read: async () => state, handoff: async (...args) => { seen.push(['handoff', args[3]]); return {...state, state: 'needs_user_handoff', manualOverride: true}; }},
    browser: {start: async () => ({owner: 'o1'}), pageSocket: async id => `ws://127.0.0.1:9/devtools/page/${id}`, closeSession: async id => { seen.push(['close', id]); return true; }}, ...extra});
  return {controller, seen};
};
test('the app\'s Submit gets the page\'s sending button only for a hidden session the form judge found ready, never after a hand-off', async () => {
  const ready = {session: 'bg', owner: 'o1', state: 'ready_for_review', submitControl: 'Envoyer'};
  assert.equal(await held(ready).controller.submitControl('bg'), 'Envoyer');
  assert.equal(await held(ready).controller.submitControl('visible'), '');
  assert.equal(await held({...ready, state: 'needs_user_handoff', manualOverride: true}).controller.submitControl('bg'), '');
  assert.equal(await held({...ready, session: 'other'}).controller.submitControl('bg'), '');
  assert.equal(await held({...ready, submitControl: undefined}).controller.submitControl('bg'), '');
});

test('Open in my browser reads the hand-off from the held tab before it closes, and hands the job to the person', async () => {
  const {controller, seen} = held({session: 'bg', owner: 'o1', state: 'ready_for_review'});
  const result = await controller.handOver('bg', async address => { seen.push(['read', address]); return {url: 'https://jobs.example.test/h/apply'}; });
  assert.deepEqual(result, {ok: true, handoff: {url: 'https://jobs.example.test/h/apply'}});
  assert.deepEqual(seen.map(([what]) => what), ['read', 'handoff', 'close'], 'read first, then the hand-over is saved, then the hidden tab closes');
  assert.equal(seen[1][1], 'opened_in_browser');
  const none = held({});
  assert.equal((await none.controller.handOver('visible', async () => { throw new Error('never read'); })).ok, false);
  const unreadable = held({session: 'bg', owner: 'o1', state: 'filling'});
  assert.deepEqual(await unreadable.controller.handOver('bg', async () => { throw new Error('page gone'); }), {ok: true, handoff: null}, 'a page that cannot be read still hands the job over; the fill starts again in Chrome');
});

const refuse = () => { throw Object.assign(new Error('This job is not eligible to start another application.'), {code: 'NOT_ELIGIBLE'}); };
const fillConfig = () => ({mode: 'fill', chosenAt: '2026-10-28T10:00:00Z'});

test('a job the store refuses as not eligible comes back as a plain answer with what to do, never a thrown error, and starts no browser', async () => {
  touched.length = 0;
  const result = await make({config: fillConfig, store: {queue: async () => refuse()}, browser: {ready: () => true, start: spy('browser.start')}})
    .enqueue([{url: 'https://jobs.example.test/lead'}], 'fill');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'This job is not eligible to start another application. Pick another job in Jobs and try again.');
  assert.deepEqual(touched, [], 'no session started, no browser launched');
});

test('in a batch, an ineligible job is skipped and said while the others still start; any other failure stops the batch with its own words', async () => {
  touched.length = 0;
  const queue = async url => (url.endsWith('/lead') ? refuse() : {session: `s-${url.slice(-1)}`});
  const terminals = {list: () => [], byUrl: () => null, record: () => null, startForm: ({id}) => { touched.push(`startForm ${id}`); return {id}; }};
  const result = await make({config: fillConfig, store: {queue}, terminals, token: () => 'test-token', log: () => {}, browser: {ready: () => true, start: async () => { touched.push('browser.start'); return {owner: 'o'}; }}})
    .enqueue([{url: 'https://jobs.example.test/lead'}, {url: 'https://jobs.example.test/b'}], 'fill');
  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions, ['s-b']);
  assert.match(result.message, /1 application queued.*1 job was skipped: not eligible/);
  assert.deepEqual(touched, ['startForm s-b', 'browser.start']);
  const broken = await make({config: fillConfig, store: {queue: async () => { throw new Error('Could not write the application record.'); }}, browser: {ready: () => true, start: spy('browser.start')}})
    .enqueue([{url: 'https://jobs.example.test/a'}, {url: 'https://jobs.example.test/b'}], 'fill');
  assert.deepEqual(broken, {ok: false, error: 'Could not write the application record.', outcomes: [
    {url: 'https://jobs.example.test/a', title: '', company: '', status: 'failed', reason: 'Could not write the application record.'},
  ]}, 'a real failure stays distinct from "not eligible" and is shown for its job');
});

// Why (2026-10-28, owner: "Finish the 'Full automation' flow"; project safety rule "10-minute wait with Stop"): the one test of the wait: once the person has pressed Stop, an elapsed timer must never issue the press.
test('Stop during the 10-minute wait hands the job to the person, and the elapsed timer issues no press; without Stop the same state does issue it', async () => {
  const now = Date.parse('2026-10-28T21:30:00Z'), handoffs = [];
  const waiting = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'waiting_to_submit', readyAt: now - 11 * 60000, manualOverride: false};
  const controller = stuck => createBackgroundApplyController({}, {
    store: {read: async () => waiting, handoff: async (_url, _id, _owner, reason) => { handoffs.push(reason); return {...waiting, state: 'needs_user_handoff', manualOverride: true, reason}; }},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {}, ...(stuck ? {stuck} : {})}], record: () => null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 10}}), now: () => now, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const stopped = await controller('stopped').handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(stopped.checks, [], 'no press after Stop');
  assert.deepEqual(handoffs, ['stopped'], 'the job went to the person');
  const untouched = await controller('').handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(untouched.checks, [{session: 's1'}], 'positive control: with no Stop the elapsed wait does ask for the press');
});

test('at start every background job left mid-press is handed to the person with its words, and nothing launches or presses', async () => {
  const records = {s1: {id: 's1'}, s2: {id: 's2'}, s3: {id: 's3'}}, reports = [], notices = [], launched = [];
  const interrupted = {s1: {state: 'needs_user_handoff', reason: 'submission_outcome_unknown', mode: 'auto', manualOverride: true}};
  interrupted.s5 = interrupted.s1;   // a press this run started: in flight, not cut off
  const controller = createBackgroundApplyController({}, {
    store: {interrupted: async (url, session) => interrupted[session] || null, ready: spy('store.ready'), reserve: spy('store.reserve')},
    browser: {start: (...args) => launched.push(args)},
    terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/1', background: {}, outcome: '', startedAt: '2020-01-01T00:00:00Z'}, {id: 's2', url: 'https://jobs.example.test/2', background: {}, outcome: '', startedAt: '2020-01-01T00:00:00Z'},
      {id: 's5', url: 'https://jobs.example.test/5', background: {}, outcome: '', startedAt: new Date().toISOString()},
      {id: 's3', url: 'https://jobs.example.test/3', background: {}, outcome: 'Applied'}, {id: 'v', url: 'https://jobs.example.test/4', outcome: ''}], record: id => records[id] || null, report: (id, event) => reports.push([id, event])},
    notify: (...args) => notices.push(args)});
  touched.length = 0;
  assert.deepEqual(await controller.sweepInterrupted(), ['s1'], 'only the job whose press was cut off; a finished job and a visible session are not asked');
  assert.match(notices[0][1], /Check whether it went through/);
  assert.match(reports[0][1].message, /Check whether it went through/);
  assert.deepEqual(launched, [], 'no browser starts');
  assert.deepEqual(touched, [], 'nothing is reserved or readied');
});

test('a press with no reply after 3 minutes is handed to the person by the app itself, with the same words, and nothing launches or presses', async () => {
  const reports = [], notices = [], launched = [], asked = [];
  const controller = createBackgroundApplyController({}, {
    store: {interrupted: async (url, session, options) => { asked.push([session, options]); return session === 's1' ? {state: 'needs_user_handoff', reason: 'submission_outcome_unknown', mode: 'auto', manualOverride: true} : null; }, ready: spy('store.ready'), reserve: spy('store.reserve')},
    browser: {start: (...args) => launched.push(args)},
    terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/1', background: {state: 'submitting'}, outcome: '', startedAt: new Date().toISOString()}, {id: 's2', url: 'https://jobs.example.test/2', background: {state: 'submitting'}, outcome: ''},
      {id: 's4', url: 'https://jobs.example.test/6', background: {state: 'ready_for_review'}, outcome: ''}, {id: 's6', url: 'https://jobs.example.test/7', background: {state: 'needs_user_handoff'}, outcome: ''},
      {id: 'v', url: 'https://jobs.example.test/4', outcome: ''}], record: () => ({}), report: (id, event) => reports.push([id, event])},
    notify: (...args) => notices.push(args)});
  touched.length = 0;
  assert.deepEqual(await controller.sweepStalled(), ['s1'], 'a press of this very run counts too; a visible session is not asked');
  assert.deepEqual(asked.map(([, options]) => options.afterMs), [180000, 180000], 'only a press older than 3 minutes');
  assert.deepEqual(asked.map(([session]) => session), ['s1', 's2'], 'only sessions whose cached state is mid-press are asked: no store call for one ready for review or already handed over');
  assert.match(notices[0][1], /Check whether it went through/);
  assert.doesNotMatch(notices[0][1], /closed/, 'the words fit a lost reply as well as a quit');
  assert.match(reports[0][1].message, /Check whether it went through/);
  assert.deepEqual([launched, touched], [[], []]);
});

// A quit is a Stop (owner, 30 Oct 2026, after #2598's restart step saw Full automation press 80 s after a restart on the wait the quit cut off).
test('after a restart a job an earlier run held goes to the person, at start and on the first poll, and its run-out wait asks no press', async () => {
  const now = Date.parse('2026-10-30T16:30:00Z'), started = now - 5000, asked = [], notices = [];
  const waiting = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'waiting_to_submit', readyAt: now - 2 * 60000, manualOverride: false};
  const handed = {...waiting, state: 'needs_user_handoff', reason: 'app_closed', manualOverride: true};
  const controller = startedAt => {
    let state = waiting;
    return createBackgroundApplyController({}, {
      store: {read: async () => state, interrupted: async (_url, session, options) => { asked.push([session, options]); return options?.quit && !state.manualOverride ? (state = handed) : null; }},
      browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {}, outcome: '', startedAt}], record: () => null, report: () => {}},
      config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), now: () => now, started, token: () => 't', notify: (...args) => notices.push(args), stop: () => false, log: () => {}});
  };
  const before = new Date(started - 60000).toISOString();
  const polled = await controller(before).handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(polled.checks, [], 'the wait the quit cut off asks no press, even before the start-up sweep');
  assert.deepEqual(asked, [['s1', {quit: true}]], 'the job went to the person through the crash rule\'s writer');
  assert.match(notices[0][1], /app was closed/);
  asked.length = 0;
  assert.deepEqual(await controller(before).sweepInterrupted(), ['s1'], 'the start-up sweep hands it over too');
  assert.deepEqual(asked, [['s1', {quit: true}]]);
  const fresh = await controller(new Date(started + 1000).toISOString()).handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(fresh.checks, [{session: 's1'}], 'positive control: a job this run started still presses when its wait runs out');
});

// Gitar on #2598: a hand-over that does not save must not let the job go on; a quit is a Stop even when the store write fails.
test('a job an earlier run held whose hand-over fails is still never claimed or pressed', async () => {
  const now = Date.parse('2026-10-30T16:30:00Z'), started = now - 5000, claimed = [];
  const waiting = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'waiting_to_submit', readyAt: now - 2 * 60000, manualOverride: false};
  const controller = startedAt => createBackgroundApplyController({}, {
    store: {read: async () => waiting, interrupted: async () => { throw new Error('store unavailable'); }, claim: async (...args) => { claimed.push(args); return {ok: false}; }},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {}, outcome: '', startedAt}], record: () => null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), now: () => now, started, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const polled = await controller(new Date(started - 60000).toISOString()).handle({action: 'poll', owner: 'o1'});
  assert.deepEqual([polled.checks, polled.jobs, claimed], [[], [], []], 'no press, no claim while the hand-over did not save');
  const fresh = await controller(new Date(started + 1000).toISOString()).handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(fresh.checks, [{session: 's1'}], 'positive control: the same store outage does not stop a job this run started');
});

// Gitar on #2598: the cache is saved 1.5 s after a move, so a quit can leave the store handed over and the cache not; such a job still goes the hand-off way.
test('a job an earlier run held that the store already handed over goes the normal hand-off way, even when its cache missed it', async () => {
  const now = Date.parse('2026-10-30T16:30:00Z'), started = now - 5000;
  const handed = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'needs_user_handoff', reason: 'stopped', manualOverride: true};
  const controller = createBackgroundApplyController({}, {
    store: {read: async () => handed, interrupted: async () => null},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {state: 'waiting_to_submit', manualOverride: false}, outcome: '', startedAt: new Date(started - 60000).toISOString()}], record: () => null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), now: () => now, started, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const polled = await controller.handle({action: 'poll', owner: 'o1'});
  assert.deepEqual([polled.handoffs, polled.checks], [[{session: 's1', reason: 'stopped', reveal: true}], []], 'the stale cache does not hide the store\'s hand-over');
});

// Found by #2598's restart steps (30 Oct 2026): a handed-over session whose job was then removed made store.read throw on every poll, so no later job was ever claimed.
test('an open session whose job record is gone does not stop the poll: the queued job is still claimed', async () => {
  const queued = {session: 'new', mode: 'auto', chosenAt: 'c1', state: 'queued', owner: ''};
  const controller = createBackgroundApplyController({}, {
    store: {read: async url => { if (url.endsWith('/gone')) throw new Error('This job has no Application record. Prepare its kit first.'); return queued; },
      claim: async () => ({ok: true, state: {...queued, state: 'preflight', owner: 'o1'}})},
    browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => [{id: 'old', url: 'https://jobs.example.test/gone', background: {state: 'needs_user_handoff', manualOverride: true}, outcome: ''}, {id: 'new', url: 'https://jobs.example.test/new', background: {}, outcome: ''}], record: () => null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const polled = await controller.handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(polled.jobs.map(job => job.session), ['new'], 'the removed job is skipped, the queued one starts');
});

test('one moved clock drives the store reservation and poll; Stop and quit still refuse after due', async t => {
  const previous = process.env.JOBADABRA_E2E; process.env.JOBADABRA_E2E = '1';
  t.after(() => { if (previous === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = previous; });
  const {createBackgroundApplyStore} = await import('../../../lib/background-apply-store.js');
  const {createBackgroundWaitClock} = await import('../../../lib/background-apply-clock.js');
  for (const handoff of ['', 'stopped', 'app_closed']) {
    const clock = createBackgroundWaitClock({env: {JOBADABRA_E2E: '1'}, wallNow: () => 1000});
    const app = {id: 'app', url: 'https://jobs.example.test/clock', stage: 'Kit ready'}, sections = new Map(), events = [], records = new Map();
    const call = async (_storage, entity, method, args) => {
      if (entity === 'applications' && method === 'get') return app;
      if (entity === 'applications' && method === 'section') return sections.get(args.name) || '';
      if (entity === 'applications' && method === 'set_section') { sections.set(args.name, args.markdown); return; }
      if (entity === 'events' && method === 'list') return events;
      if (entity === 'events' && method === 'add') { events.push(args); return; }
      throw new Error(`unexpected ${entity}.${method}`);
    };
    sections.set('📝 Application kit', '```json\n{"eligible":true,"answers":[]}\n```');
    const config = {mode: 'auto', chosenAt: 'chosen', autoConfirmedAt: 'confirmed', auto: {waitMin: 1}};
    const store = createBackgroundApplyStore({}, {call, now: clock.now, uuid: () => 'attempt'});
    const terminals = {list: () => [...records.values()], byUrl: () => null, record: id => records.get(id), report: () => {}, startForm: item => {
      const record = {...item, startedAt: new Date(1000).toISOString()}; records.set(item.id, record); return record;
    }};
    const controller = createBackgroundApplyController({}, {store, now: clock.now, started: 0, config: () => config, uuid: () => 'session1', terminals,
      browser: {ready: () => true, start: async () => ({owner: 'owner'})}, stop: () => false, reader: {busy: () => false, take: () => null, takeEnded: () => []},
      port: 1, token: () => 'fictional', notify: () => {}, log: () => {}});
    await controller.enqueue([app], 'auto');
    await controller.handle({action: 'poll', owner: 'owner'});
    const body = {background: {owner: 'owner', session: 'session1'}, sketch: {page: 'same'}};
    const answer = {answer: 'ready', step: 'final', submitControl: 'Send', confidence: 1, botCheck: false};
    const readyPayload = async () => ({action: 'ready', owner: 'owner', session: 'session1', ...(await controller.judgment(body, answer)), requiredComplete: true, safe: true, factsOnly: true});
    assert.equal((await controller.handle(await readyPayload())).reason, 'waiting');
    const held = records.get('session1').background;
    assert.equal(held.dueAt, 61000);
    assert.deepEqual(held.waitDecision, {via: 'extension', at: 1000, dueAt: 61000, state: 'waiting_to_submit', reason: 'waiting'});
    assert.deepEqual((await controller.handle({action: 'poll', owner: 'owner'})).checks, []);
    if (handoff === 'stopped') await controller.handle({action: 'manual', owner: 'owner', session: 'session1', reason: 'stopped'});
    if (handoff === 'app_closed') await controller.sweepInterrupted(2000);
    const at = clock.moveTo(held.dueAt + 1);
    const poll = await controller.handle({action: 'poll', owner: 'owner'});
    const decision = records.get('session1').background.waitDecision;
    assert.equal(decision.at, at, 'the verdict is from the poll after the move');
    assert.equal(decision.reason, handoff || 'due');
    assert.equal(decision.state, handoff ? 'needs_user_handoff' : 'waiting_to_submit');
    assert.deepEqual(poll.checks, handoff ? [] : [{session: 'session1'}]);
    if (!handoff) {
      const payload = await readyPayload();
      assert.equal((await controller.handle(payload)).submit, true, 'the store reads the same advanced clock');
      assert.equal((await controller.handle(payload)).submit, undefined, 'a consumed proof never presses twice');
      assert.equal(records.get('session1').background.waitDecision.reason, 'authorized');
      assert.equal(events.length, 1);
    } else {
      assert.equal((await controller.handle(await readyPayload())).submit, undefined);
      assert.equal(events.length, 0, 'no attempt is reserved after Stop or quit');
    }
  }
});

test('moving the e2e clock after a quit starts the owned scheduler and records its refusal', async () => {
  const previous = process.env.JOBADABRA_E2E;
  process.env.JOBADABRA_E2E = '1';
  try {
    const {backgroundWaitNow, moveBackgroundWaitClock} = await import('../../../lib/background-apply-clock.js');
    const readyAt = backgroundWaitNow(), record = {id: 'clock-quit', url: 'https://jobs.example.test/clock-quit', startedAt: new Date(readyAt - 1000).toISOString(), background: {}};
    let state = {session: record.id, mode: 'auto', state: 'waiting_to_submit', readyAt}, starts = 0;
    const controller = createBackgroundApplyController({}, {started: readyAt, store: {read: async () => state, interrupted: async () => (state = {...state, state: 'needs_user_handoff', reason: 'app_closed', manualOverride: true})},
      terminals: {list: () => [record], record: () => record, report: () => {}}, browser: {start: async () => { starts++; return {owner: 'owner'}; }},
      config: () => ({mode: 'auto', auto: {waitMin: 1}}), token: () => 'fictional', port: 1, notify: () => {}, log: () => {},
      reader: {takeEnded: () => []}});
    const moved = await moveBackgroundWaitClock(readyAt + 60001);
    assert.equal(starts, 1, 'the browser the quit closed is restarted without waiting for an alarm');
    assert.equal(record.background.waitDecision, undefined, 'the app clock wake cannot stand in for an extension request');
    await controller.handle({action: 'poll', owner: 'owner'});
    assert.ok(record.background.waitDecision.at >= moved);
    assert.equal(record.background.waitDecision.via, 'extension');
    assert.deepEqual([record.background.waitDecision.state, record.background.waitDecision.reason], ['needs_user_handoff', 'app_closed']);
  } finally {
    if (previous === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = previous;
  }
});


function reservationProof(t) {
  const previous = process.env.JOBADABRA_E2E; process.env.JOBADABRA_E2E = '1';
  t.after(() => { if (previous === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = previous; });
  let state = {session: 'bg', owner: 'o1', mode: 'auto', state: 'waiting_to_submit', readyAt: 1000}, missing = false, id = 0, attempts = 0;
  const record = {id: 'bg', url: 'https://jobs.example.test/proof', background: {}};
  const controller = createBackgroundApplyController({}, {now: () => 1001, uuid: () => `proof-${++id}`, config: () => ({auto: {waitMin: 0}}),
    store: {read: async () => missing ? null : state, ready: async () => state, reserve: async () => {
      if (state.state === 'submitting') return {submit: false, reason: 'manual_or_already_attempted', state: state.state};
      attempts++; state = {...state, state: 'submitting'}; return {submit: true, state: state.state, attempt: 'one'};
    }}, browser: {start: async () => ({owner: 'o1'})}, terminals: {record: () => record, report: () => {}}, token: () => 'fictional', port: 1, log: () => {}});
  const payload = async () => ({action: 'ready', owner: 'o1', session: 'bg', requiredComplete: true, factsOnly: true, safe: true,
    ...(await controller.judgment({background: {owner: 'o1', session: 'bg'}, sketch: {}}, {answer: 'ready', step: 'final', confidence: 1, botCheck: false}))});
  return {controller, record, payload, disappear: () => { missing = true; }, attempts: () => attempts};
}

test('a null read after reservation does not crash the ready response', async t => {
  const proof = reservationProof(t), payload = await proof.payload();
  proof.disappear();
  assert.equal((await proof.controller.handle(payload)).submit, true);
});

test('a second concurrent ready verdict preserves the first authorization decision', async t => {
  const proof = reservationProof(t), first = await proof.payload(), second = await proof.payload();
  const [authorized, refused] = await Promise.all([proof.controller.handle(first), proof.controller.handle(second)]);
  assert.equal(authorized.submit, true); assert.equal(refused.submit, false);
  assert.equal(proof.attempts(), 1);
  assert.equal(proof.record.background.waitDecision.reason, 'authorized');
  assert.equal(proof.record.background.waitDecision.via, 'extension');
});

test('ordinary sessions never cache an e2e wait decision', async t => {
  const previous = process.env.JOBADABRA_E2E; delete process.env.JOBADABRA_E2E;
  t.after(() => { if (previous !== undefined) process.env.JOBADABRA_E2E = previous; });
  const now = Date.now(), state = {session: 'bg', mode: 'auto', state: 'needs_user_handoff', manualOverride: true, reason: 'stopped', readyAt: now - 60000};
  const record = {id: 'bg', url: 'https://jobs.example.test/ordinary', background: {}};
  const controller = createBackgroundApplyController({}, {store: {read: async () => state}, browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => [record], record: () => record, report: () => {}}, config: () => ({auto: {waitMin: 1}}), token: () => 'fictional', port: 1,
    reader: {takeEnded: () => []}});
  await controller.handle({action: 'poll', owner: 'o1'});
  assert.equal(Object.hasOwn(record.background, 'waitDecision'), false);
  assert.equal(Object.hasOwn(record.background, 'waitClockOffset'), false);
});

test('a clock wake leaves queued triage reads and ended-page closes for the extension', async t => {
  const previous = process.env.JOBADABRA_E2E; process.env.JOBADABRA_E2E = '1';
  t.after(() => { if (previous === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = previous; });
  const {backgroundWaitNow, moveBackgroundWaitClock} = await import('../../../lib/background-apply-clock.js');
  let taken = 0, ended = 0;
  const controller = createBackgroundApplyController({}, {store: {}, terminals: {list: () => []}, config: () => ({}),
    browser: {start: async () => ({owner: 'reader-owner'})}, token: () => 'fictional', port: 1,
    reader: {take: () => { taken++; return {id: 'read-next', url: 'https://jobs.example.test/read'}; }, takeEnded: () => { ended++; return ['read-ended']; }}});
  await moveBackgroundWaitClock(backgroundWaitNow() + 1);
  assert.deepEqual([taken, ended], [0, 0], 'waking the browser must not consume one-shot commands');
  const commands = await controller.handle({action: 'poll', owner: 'reader-owner'});
  assert.deepEqual(commands.closes, [{session: 'read-ended'}]);
  assert.equal(commands.jobs[0].session, 'read-next');
  assert.deepEqual([taken, ended], [1, 1]);
});

// Owner, 5 Nov 2026: "We want to be able to run 10 sessions in parallel, headless, and being very performant" (plan decision 3: all of a batch, up to 10; replaces #2646's one at a time).
// A multi-step form saves 'filling' at its middle step; it still counts against the limit, in either list order.
const pollRig = (states, order) => {
  const claimed = [], reads = [];
  const controller = createBackgroundApplyController({}, {
    store: {read: async url => { reads.push(url); return states[url.split('/').pop()]; },
      claim: async (url, session) => { const state = states[session]; claimed.push(session); return state.state === 'queued' ? {ok: true, state: {...state, state: 'preflight', owner: 'o1'}} : {ok: state.owner === 'o1', state}; },
      handoff: async (_url, session, _owner, reason) => ({...states[session], state: 'needs_user_handoff', manualOverride: true, reason})},
    browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => order.map(id => ({id, url: `https://jobs.example.test/${id}`, background: {}, outcome: ''})), record: id => ({id, background: {}}), report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const poll = async () => (await controller.handle({action: 'poll', owner: 'o1'}));
  return {controller, poll, claimed, reads};
};
const job = (session, state, owner = 'o1') => ({session, mode: 'auto', chosenAt: 'c1', state, owner});

test('every queued job of a batch fills at once, up to 10; one still filling (a multi-step form\'s middle step) counts against the limit in either list order', async () => {
  const ten = Object.fromEntries(Array.from({length: 10}, (_, i) => [`j${i}`, job(`j${i}`, 'queued', '')]));
  const batch = pollRig(ten, Object.keys(ten));
  assert.deepEqual((await batch.poll()).jobs.map(each => each.session), Object.keys(ten), 'ten queued jobs launch in one poll');
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const {poll} = pollRig({a: job('a', 'filling'), b: job('b', 'queued', '')}, order);
    assert.deepEqual((await poll()).jobs.map(each => each.session), ['b'], `a form at its middle step does not hold the next job (order ${order})`);
  }
  const full = Object.fromEntries([...Array.from({length: 10}, (_, i) => [`f${i}`, job(`f${i}`, 'filling')]), ['late', job('late', 'queued', '')]]);
  const {poll, claimed} = pollRig(full, Object.keys(full));
  assert.deepEqual((await poll()).jobs, [], 'ten filling: the eleventh waits');
  assert.ok(!claimed.includes('late'));
});

test('the poll reads the store once per job after a start, then uses what the controller last wrote (measured: 2 store subprocesses per job per poll before)', async () => {
  const states = {a: job('a', 'queued', ''), b: job('b', 'filling')};
  const {poll, reads} = pollRig(states, ['a', 'b']);
  await poll();
  assert.equal(reads.length, 2, 'the first poll reads each job once');
  await poll();
  await poll();
  assert.equal(reads.length, 2, 'later polls read nothing: the controller is the state\'s one writer');
});

test('Stop reaches every job filling at once: each is handed to the person', async () => {
  const states = Object.fromEntries(Array.from({length: 4}, (_, i) => [`s${i}`, job(`s${i}`, i % 2 ? 'filling' : 'queued', i % 2 ? 'o1' : '')]));
  let stopped = false;
  const handed = [];
  const controller = createBackgroundApplyController({}, {
    store: {read: async url => states[url.split('/').pop()], claim: async (_url, session) => ({ok: true, state: {...states[session], state: 'preflight', owner: 'o1'}}),
      handoff: async (_url, session, _owner, reason) => { handed.push([session, reason]); return {...states[session], state: 'needs_user_handoff', manualOverride: true, reason}; }},
    browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => Object.keys(states).map(id => ({id, url: `https://jobs.example.test/${id}`, background: {}, outcome: ''})), record: id => ({id, background: {}}), report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), token: () => 't', notify: () => {}, stop: () => stopped, log: () => {}});
  assert.deepEqual((await controller.handle({action: 'poll', owner: 'o1'})).jobs.map(each => each.session), ['s0', 's2'], 'the two queued launch beside the two filling');
  stopped = true;
  const after = await controller.handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(handed.map(([session, reason]) => `${session}:${reason}`).sort(), ['s0:stopped', 's1:stopped', 's2:stopped', 's3:stopped']);
  assert.equal(after.jobs.length, 0, 'nothing launches after Stop');
  assert.equal(after.handoffs.length, 4, 'the extension is told about each');
});

// Owner, 2 Nov 2026 ("the app sends one e-mail/Telegram message when an application is stuck waiting for you"): both hand-over sites tell the waiting message; it never breaks the hand-over.
test('a hand-over to the person (Stop, cut off at start) also queues the message to e-mail and Telegram, and a failing message does not break it', async () => {
  const queued = [], handoffs = [], waiting = {add: item => queued.push(item)};
  const records = {s1: {id: 's1', title: 'Nurse', company: 'Demo Klinik', outcome: ''}};
  const build = (extra = {}, startedAt = '2020-01-01T00:00:00Z') => createBackgroundApplyController({}, {
    store: {interrupted: async () => ({state: 'needs_user_handoff', reason: 'submission_outcome_unknown', mode: 'auto', manualOverride: true}),
      read: async () => ({session: 's1', mode: 'auto', chosenAt: 'c1', state: 'waiting_to_submit', readyAt: 0, manualOverride: false}),
      handoff: async (_url, _id, _owner, reason) => { handoffs.push(reason); return {mode: 'auto', state: 'needs_user_handoff', manualOverride: true, reason}; }},
    browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/1', title: 'Nurse', company: 'Demo Klinik', background: {}, outcome: '', startedAt}], record: id => records[id] || null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 10}}), token: () => 't', notify: () => {}, stop: () => 'stopped', log: () => {}, waiting, ...extra});
  await build().sweepInterrupted();
  assert.equal(queued.length, 1, 'cut off at start: queued');
  assert.deepEqual([queued[0].id, queued[0].title, queued[0].company], ['s1', 'Nurse', 'Demo Klinik']);
  assert.match(queued[0].note, /Check whether it went through/);
  assert.equal(queued[0].open(), true, 'still waiting: the message may name it');
  records.s1.outcome = 'Applied';
  assert.equal(queued[0].open(), false, 'handled meanwhile: left out of the message');
  records.s1.outcome = '';
  await build({}, '2099-01-01T00:00:00Z').handle({action: 'poll', owner: 'o1'});   // a start after the app's own start (a job this run started), Stop during the wait: markManual
  assert.deepEqual(handoffs, ['stopped']);
  assert.equal(queued.length, 2, 'Stop: queued too');
  const broken = build({waiting: {add: () => { throw new Error('boom'); }}});
  assert.deepEqual(await broken.sweepInterrupted(), ['s1'], 'a failing message never breaks the hand-over');
});

// Why (5 Nov 2026, owner's screenshot: a Full automation batch showed a re-applied job as "Needs you · Try again" in its old mode; review of [ap] 2/7): the new run must
// launch at the next poll, whatever the old session carried (the person's Stop mark, a start time from an earlier app run). The real store; terminals as lib/terminals.js
// behaves: startForm returns the open record of the same job unchanged, remove drops it.
test('a job applied to again after Stop or an earlier app run launches at the next poll, as a new session in the new mode', async () => {
  const {createBackgroundApplyStore} = await import('../../../lib/background-apply-store.js');
  const url = 'https://jobs.example.test/again', NOW = Date.parse('2026-11-05T10:00:00Z');   // one fixed time: this app run started a second before it
  for (const [name, old] of [['Stop in this run', {stuck: 'stopped', startedAt: new Date(NOW).toISOString(), reason: 'stopped'}],
    ['an earlier app run', {startedAt: '2026-11-01T10:00:00Z', reason: 'app_closed'}]]) {
    const app = {id: 'app', url, stage: 'Kit ready'}, sections = new Map(), records = new Map();
    sections.set('Background Apply', JSON.stringify({version: 1, session: 'old', mode: 'fill', chosenAt: 'c0', state: 'needs_user_handoff', owner: 'o1', manualOverride: true, reason: old.reason}));
    sections.set('📝 Application kit', '```json\n{"eligible":true,"answers":[]}\n```');
    const call = async (_storage, entity, method, args) => {
      if (entity === 'applications' && method === 'get') return app;
      if (entity === 'applications' && method === 'section') return sections.get(args.name) || '';
      if (entity === 'applications' && method === 'set_section') { sections.set(args.name, args.markdown); return null; }
      if (entity === 'events' && method === 'list') return [];
      throw new Error(`unexpected ${entity}.${method}`);
    };
    records.set('old', {id: 'old', kind: 'form', url, outcome: '', stuck: old.stuck || '', startedAt: old.startedAt, background: {mode: 'fill', state: 'needs_user_handoff', manualOverride: true}});
    const terminals = {list: () => [...records.values()], byUrl: u => [...records.values()].filter(r => r.url === u).pop() || null, record: id => records.get(id) || null, report: () => {},
      remove: id => records.delete(id),
      startForm: item => [...records.values()].find(r => r.url === item.url && r.kind === 'form' && !r.outcome) || (records.set(item.id, {...item, kind: 'form', outcome: '', startedAt: new Date(NOW).toISOString()}), records.get(item.id))};
    let n = 0;
    const closed = [];
    const controller = createBackgroundApplyController({}, {store: createBackgroundApplyStore({}, {call, now: () => NOW, realNow: () => NOW, uuid: () => 'attempt'}), uuid: () => `newrun0${++n}-fictional`,
      config: () => ({mode: 'auto', chosenAt: 'c1', autoConfirmedAt: '2026-11-05T09:00:00Z', auto: {waitMin: 1}}), terminals, started: NOW - 1000, stop: () => false,
      browser: {ready: () => true, start: async () => ({owner: 'o1'}), closeSession: async id => { closed.push(id); return true; }}, reader: {busy: () => false, take: () => null, takeEnded: () => []}, port: 1, token: () => 'fictional', notify: () => {}, log: () => {}});
    const queued = await controller.enqueue([{url, company: 'Fictional Air'}], 'auto');
    assert.equal(queued.ok, true, `${name}: ${queued.error || ''}`);
    const poll = await controller.handle({action: 'poll', owner: 'o1'});
    assert.deepEqual(poll.handoffs, [], `${name}: nothing handed back`);
    assert.deepEqual(poll.jobs.map(job => [job.session, job.mode]), [['newrun01', 'auto']], `${name}: the new run launches in Full automation`);
    assert.deepEqual([...records.keys()], ['newrun01'], `${name}: the finished old session left the list`);
    assert.deepEqual(closed, ['old'], `${name}: the old run's hidden tab is closed with it`);
  }
});
