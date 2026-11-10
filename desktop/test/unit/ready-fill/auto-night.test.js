// The cloud runner's Full automation task (desktop/ready-fill/auto-night.mjs, auto-commands.mjs; spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto"): each queued job is pressed at most once,
// only through the real submit-gate.js after the site reserved its attempt, and only its own page's send passes the net, only during its permit. The site is faked at fetch (its /api/ready/ai answers as a model
// would) and the browser by a stand-in whose worker plays the extension's side of the Mac's hidden browser: poll, the form judge, `ready`, the press through the net, the receipt watch.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runNight} from '../../../ready-fill/night.mjs';
import {AUTO_OWNER, createAutoLine} from '../../../ready-fill/auto-commands.mjs';

const NOW = Date.now();
const item = (id, change = {}) => ({job: id, url: `https://jobs.example.com/acme/${id}`, session: `s-${id}`, state: 'cloud', manualOverride: false, mode: 'auto', chosenAt: new Date(NOW - 86400000).toISOString(),
  autoConfirmedAt: new Date(NOW - 3600000).toISOString(), queuedAt: NOW - 3000000, allowIneligible: false, waitMin: 0, ...change});
const job = (id, change = {}, itemChange = {}) => ({id, url: `https://jobs.example.com/acme/${id}`, title: 'SRE', company: 'Acme', kit: {}, cv: '', letterPdf: '', item: item(id, itemChange), stage: 'Kit ready', eligible: true, ...change});
const SKETCH = {title: 'Apply: SRE', headings: ['Apply'], controls: [{type: 'text', label: 'Name', required: true, state: 'filled'}], buttons: ['Submit application']};
const FORM = {answer: 'ready', blocked_kind: '', needs: '', needs_kind: '', step: 'final', next_control: '', submit_control: 'Submit application', bot_check: false, login_wall: false, account_to_create: false, confidence: 0.95};
const said = text => ({content: [{type: 'text', text: JSON.stringify(text)}], stop_reason: 'end_turn', usage: {}});

// The site: the batch, the live line (a Stop per job), /reserve, /result, and its AI (the form judge and the confirmation judge, by their system prompts).
function site({jobs, reserve = () => ({ok: true, attempt: 'a-1'}), stops = new Set(), form = FORM, confirmed = true}) {
  const seen = {results: [], reserved: [], ai: 0};
  const fetchImpl = async (url, options = {}) => {
    const route = new URL(url).pathname.split('/').pop(), body = options.body ? JSON.parse(options.body) : null;
    const reply = value => ({ok: true, status: 200, json: async () => value});
    if (route === 'batch') return reply({ok: true, line: true, task: 'auto', sentAt: new Date(NOW - 600000).toISOString(), jobs, facts: {}});
    if (route === 'progress') return reply({ok: true, stop: stops.has(body.job)});
    if (route === 'reserve') { seen.reserved.push(body.job); return reply(reserve(body.job)); }
    if (route === 'result') { seen.results.push(body); return reply({ok: true}); }
    if (route === 'ai') { seen.ai++; return reply(/JOB APPLICATION form/.test(body.system) ? said(typeof form === 'function' ? form() : form) : /confirmation that an application was submitted/.test(body.system) ? said({confirmation: confirmed, bot_check: false}) : said({})); }
    return reply({});
  };
  return {fetchImpl, seen};
}

// A browser with one worker that plays the extension: each poll's command opens a page, the page is judged, `ready` is asked, a permit is pressed (a navigating POST through the net), the landed page is judged.
// pageStatus: the status the job's page answers when it opens. pressEarly: the page tries to send before any permit.
function fakeChromium(seen, {pageStatus = 200, pressEarly = false, lostReceipt = false} = {}) {
  let port = 0, storage = {}, routeHandler = null;
  const listeners = {page: [], response: []};
  const call = async (route, body) => (await fetch(`http://127.0.0.1:${port}${route}`, {method: 'POST', body: JSON.stringify(body)})).json();
  const send = (page, url) => new Promise(resolve => routeHandler({request: () => ({method: () => 'POST', url: () => url, isNavigationRequest: () => true, frame: () => ({page: () => page, parentFrame: () => null})}),
    continue: () => { seen.sent.push(url); resolve(true); }, abort: () => { seen.refused.push(url); resolve(false); }}));
  const worker = {evaluate: async (fn, values) => {
    if (values?.workerUrl) { port = Number(new URL(values.workerUrl).port); storage = values; seen.owner = values.backgroundOwner; return true; }
    if (!String(fn).includes('__jobPilottoBackgroundSessions')) return true;
    const owner = storage.backgroundOwner, polled = await call('/extension/background-apply', {action: 'poll', owner});
    for (const command of [...polled.jobs || [], ...polled.checks || []]) await play(owner, command);
    return true;
  }};
  // A command's page opens once (its status told, an early send tried when asked); then it is judged, `ready` is asked, a permit is pressed and the landed page judged.
  async function opened(command) {
    let page = seen.pages.get(command.session);
    if (page) return page;
    page = {url: command.url, close: async () => { seen.closed++; }}; seen.pages.set(command.session, page); seen.commands.push(command);
    for (const fn of listeners.page) fn(page);
    for (const fn of listeners.response) fn({status: () => pageStatus, request: () => ({isNavigationRequest: () => true, frame: () => ({page: () => page, parentFrame: () => null})})});
    if (pressEarly) await send(page, 'https://jobs.example.com/acme/apply');
    return page;
  }
  async function play(owner, command) {
    const session = command.session, context = {owner, session, mode: 'auto', attempt: '', manual: false};
    const page = await opened(command);
    const judged = await call('/extension/account-judge', {phase: 'form', sketch: SKETCH, background: context});
    if (!judged.background?.proof) { await call('/extension/background-apply', {...context, action: 'manual', reason: 'judgment_unavailable'}); return; }
    const permit = await call('/extension/background-apply', {...context, action: 'ready', proof: judged.background.proof, requiredComplete: true, factsOnly: true, safe: true});
    seen.permits.push(permit);
    if (permit.manual) { await call('/extension/background-apply', {...context, action: 'manual', reason: permit.reason}); return; }
    if (!permit.submit) return;
    await send(page, 'https://jobs.example.com/acme/apply');
    if (lostReceipt) { await call('/extension/background-apply', {...context, action: 'manual', reason: 'submission_outcome_unknown'}); return; }
    seen.receipts.push(await call('/extension/confirmation', {job: command.url, page: 'https://jobs.example.com/acme/thanks', title: 'Thanks', headings: ['Application received'], text: 'We received your application.', inputs: 0, background: {...context, attempt: permit.attempt}}));
  }
  const context = {serviceWorkers: () => [worker], route: async (_pattern, handler) => { routeHandler = handler; }, on: (event, fn) => listeners[event]?.push(fn), newPage: async () => ({}), close: async () => {}};
  return {launchPersistentContext: async () => context, send: url => send(null, url)};
}
const fresh = () => ({commands: [], pages: new Map(), permits: [], receipts: [], sent: [], refused: [], closed: 0});
const night = (seen, site_, options = {}) => runNight({chromium: fakeChromium(seen, options), site: 'https://site.example', token: 't', task: 'auto', fetchImpl: site_.fetchImpl, log: options.log});

test('a confirmed item that passes every check is pressed once: the site reserved it first, its own page sent through the net, the receipt confirmed it', async () => {
  const seen = fresh(), logs = [], s = site({jobs: [job('j1')]});
  const done = await night(seen, s, {log: (...line) => logs.push(JSON.stringify(line))});
  assert.equal(seen.owner, AUTO_OWNER);
  assert.deepEqual(seen.commands.map(command => command.mode), ['auto']);
  assert.deepEqual(s.seen.reserved, ['j1']);
  assert.deepEqual(seen.sent, ['https://jobs.example.com/acme/apply']);
  assert.equal(s.seen.results.length, 1);
  const [result] = s.seen.results;
  assert.deepEqual({job: result.job, task: result.task, state: result.state, why: result.why, attempt: result.attempt}, {job: 'j1', task: 'auto', state: 'submitted', why: 'receipt', attempt: 'a-1'});
  assert.deepEqual(Object.keys(result.proof).sort(), ['botCheck', 'requiredComplete', 'signature', 'submitControl']);
  assert.equal(done.results.get('j1').state, 'submitted');
  assert.equal(seen.closed, 1, 'the job\'s page is closed once it ends');
  assert.ok(!logs.join('\n').includes('jobs.example.com'), 'the log has no address');
});

test('a page that sends itself before the permit is refused by the net and handed to the person at once, never reserved', async () => {
  const seen = fresh(), s = site({jobs: [job('j1')]});
  await night(seen, s, {pressEarly: true});
  assert.deepEqual(seen.refused, ['https://jobs.example.com/acme/apply'], 'the early send was refused');
  assert.deepEqual(seen.sent, [], 'nothing went');
  assert.deepEqual(s.seen.reserved, []);
  assert.deepEqual(s.seen.results.map(({state, why}) => [state, why]), [['not_submitted', 'page_sends_early']]);
});

// The review's races (10 Nov 2026, cs 3/4): a `ready` whose /reserve is still in flight when the job ends, or two overlapping `ready` calls.
const lineFor = (reserve, more = {}) => {
  const line = createAutoLine({client: {}, sentAt: new Date(NOW - 600000).toISOString(), reserve, judge: async () => ({answer: 'ready', step: 'final', submitControl: 'Submit application', botCheck: false, confidence: 0.95}),
    confirm: async () => ({confirmation: true}), ...more});
  line.begin(job('j1'));
  const context = {owner: AUTO_OWNER, session: 's-j1'};
  const ready = async () => line.background({...context, action: 'ready', proof: (await line.formJudge({phase: 'form', sketch: SKETCH, background: context})).background.proof, requiredComplete: true, safe: true});
  return {line, context, ready};
};
const later = (value, ms = 30) => new Promise(resolve => setTimeout(() => resolve(value), ms));

test('a job that ends while its reservation is in flight gets no permit: reserved, it is unknown; refused, it keeps the end it waited with', async () => {
  for (const [answer, state, attempt] of [[{ok: true, attempt: 'A1'}, 'unknown', 'A1'], [{ok: false, error: 'already'}, 'not_submitted', '']]) {
    const {line, ready} = lineFor(() => later(answer));
    const permit = ready();
    await later(null, 5);
    line.end('not_submitted', 'timeout');
    assert.equal(line.outcome(), null, 'the end waits for the reservation');
    assert.notEqual((await permit).submit, true, 'no permit after the job ended');
    assert.deepEqual([line.outcome().state, line.attempt(), line.pressing()], [state, attempt, false]);
  }
  const {line, ready} = lineFor(() => later({ok: true, attempt: 'A2'}));
  const permit = ready();
  await later(null, 5);
  assert.equal(line.stop(), false, 'a Stop during the reservation is not a stop before the press');
  assert.notEqual((await permit).submit, true);
  assert.equal(line.outcome().state, 'unknown');
});

test('two overlapping ready calls give at most one permit, and the other never decides the job', async () => {
  let asked = 0;
  const {line, context, ready} = lineFor(() => (++asked === 1 ? later({ok: true, attempt: 'A1'}) : {ok: false, error: 'already'}));
  const [first, second] = await Promise.all([ready(), ready()]);
  assert.deepEqual([first.submit, second.submit, asked], [true, undefined, 1], 'the second waits and sees the attempt');
  assert.equal(line.outcome(), null);
  assert.equal((await line.confirmation({page: 'https://jobs.example.com/acme/thanks', background: {...context, attempt: 'A1'}})).confirmation, true);
  assert.deepEqual(line.outcome(), {state: 'submitted', why: 'receipt'});
});

test('a reservation the site never answers ends the job unknown, and its late answer gives no permit', async () => {
  let answer;
  const {line, ready} = lineFor(() => new Promise(resolve => { answer = resolve; }));
  const permit = ready();
  await later(null, 5);
  line.abandon();
  assert.equal(line.outcome().state, 'unknown');
  answer({ok: true, attempt: 'A1'});
  assert.notEqual((await permit).submit, true);
  assert.equal(line.pressing(), false);
});

test('an item without its own confirmation, not eligible, or behind a bot check is never reserved nor pressed; each ends not_submitted with its reason', async () => {
  const cases = [[job('j1', {}, {autoConfirmedAt: ''}), 'not_confirmed'], [job('j2', {eligible: false}), 'not_eligible'], [job('j3', {stage: 'Applied'}), 'not_eligible']];
  for (const [each, why] of cases) {
    const seen = fresh(), s = site({jobs: [each]});
    await night(seen, s);
    assert.deepEqual(s.seen.reserved, [], why);
    assert.deepEqual(seen.sent, [], why);
    assert.deepEqual([s.seen.results[0].state, s.seen.results[0].why, s.seen.results[0].attempt], ['not_submitted', why, ''], why);
  }
  const seen = fresh(), s = site({jobs: [job('j4')], form: {...FORM, answer: 'needs_person', bot_check: true, submit_control: ''}});
  await night(seen, s);
  assert.deepEqual([s.seen.reserved, seen.sent, s.seen.results[0].state, s.seen.results[0].why], [[], [], 'not_submitted', 'bot_check']);
});

test('the day\'s ceiling or a failed reservation never presses', async () => {
  for (const [reserve, why] of [[() => ({ok: false, error: 'ceiling'}), 'ceiling'], [() => { throw new Error('down'); }, 'reserve_failed'], [() => ({ok: false, error: 'already'}), 'attempt_already_reserved']]) {
    const seen = fresh(), s = site({jobs: [job('j1')], reserve});
    await night(seen, s);
    assert.deepEqual(seen.sent, [], why);
    assert.deepEqual([s.seen.results[0].state, s.seen.results[0].why], ['not_submitted', why]);
  }
});

test('a press with no receipt is unknown (the person checks the employer\'s page), never "not sent"', async () => {
  const seen = fresh(), s = site({jobs: [job('j1')]});
  await night(seen, s, {lostReceipt: true});
  assert.deepEqual(seen.sent.length, 1);
  assert.deepEqual([s.seen.results[0].state, s.seen.results[0].attempt], ['unknown', 'a-1']);
});

test('a job the owner stopped is never reserved, pressed or reported; the next job still runs', async () => {
  const seen = fresh(), s = site({jobs: [job('j1'), job('j2')], stops: new Set(['j1'])});
  await night(seen, s);
  assert.deepEqual(s.seen.reserved, ['j2']);
  assert.deepEqual(s.seen.results.map(result => [result.job, result.state]), [['j2', 'submitted']]);
});

test('a page that answers 401, 403 or 429 ends its job before any press, no retry', async () => {
  for (const status of [401, 403, 429]) {
    const seen = fresh(), s = site({jobs: [job('j1')]});
    await night(seen, s, {pageStatus: status});
    assert.deepEqual([s.seen.reserved, seen.sent, s.seen.results[0].why], [[], [], 'blocked_status'], String(status));
  }
});

test('the item\'s own wait holds the press; the recheck after it presses, and a page that changed meanwhile starts the wait again', async () => {
  let clock = NOW;
  const judged = [], answers = [{signature: 'a'}, {signature: 'b'}, {signature: 'b'}];
  const line = createAutoLine({client: {}, now: () => clock, sentAt: NOW - 600000, reserve: async () => ({ok: true, attempt: 'a-9'}), judge: async () => ({...FORM, answer: 'ready', step: 'final', submitControl: 'Submit application', botCheck: false, confidence: 0.95})});
  const each = job('j1', {}, {waitMin: 5}), context = {owner: AUTO_OWNER, session: each.item.session};
  line.begin(each);
  const ask = async n => {
    const proof = (await line.formJudge({phase: 'form', sketch: {...SKETCH, n: answers[n].signature}, background: context})).background.proof;
    const permit = await line.background({...context, action: 'ready', proof, requiredComplete: true, safe: true});
    judged.push(permit.submit ? 'pressed' : 'waiting');
    return permit;
  };
  assert.equal((await line.background({owner: AUTO_OWNER, action: 'poll'})).jobs.length, 1);
  await ask(0);
  clock += 4 * 60000;
  assert.deepEqual((await line.background({owner: AUTO_OWNER, action: 'poll'})).checks, [], 'not due yet');
  await ask(1);   // the page changed: its wait starts again from now
  clock += 4 * 60000;
  await ask(2);   // 4 minutes into the new wait
  clock += 61000;
  assert.deepEqual((await line.background({owner: AUTO_OWNER, action: 'poll'})).checks, [{session: each.item.session}], 'due: the poll hands the recheck');
  assert.deepEqual((await ask(2)).attempt, 'a-9');
  assert.deepEqual(judged, ['waiting', 'waiting', 'waiting', 'pressed']);
});

test('the line answers only its own owner and session, and a judgment it did not make is never a proof', async () => {
  const line = createAutoLine({client: {}, sentAt: NOW, reserve: async () => ({ok: true, attempt: 'x'}), judge: async () => ({error: 'no AI'})});
  line.begin(job('j1'));
  assert.deepEqual(await line.background({owner: 'night', action: 'poll'}), {ok: false});
  assert.deepEqual(await line.background({owner: AUTO_OWNER, session: 's-other', action: 'ready', proof: 'p'}), {ok: false});
  assert.deepEqual(await line.background({owner: AUTO_OWNER, session: 's-j1', action: 'ready', proof: 'made-up'}), {ok: false, recheck: true});
  assert.deepEqual(await line.formJudge({phase: 'ready', sketch: SKETCH, background: {owner: AUTO_OWNER, session: 's-j1'}}), {}, 'an account phase is never judged here');
  assert.equal((await line.confirmation({background: {owner: AUTO_OWNER, session: 's-j1', attempt: 'x'}})).confirmation, false, 'no reserved attempt: nothing to confirm');
  let judged = 0;
  const {line: pressed, context, ready} = lineFor(async () => ({ok: true, attempt: 'A1'}), {confirm: async () => { judged++; return {confirmation: true}; }});
  assert.equal((await ready()).submit, true);
  assert.equal((await pressed.confirmation({background: {...context, attempt: 'other'}})).confirmation, false);
  assert.equal(judged, 0, 'another attempt\'s page is never sent to the AI');
});
