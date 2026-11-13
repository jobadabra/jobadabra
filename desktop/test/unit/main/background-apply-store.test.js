// Persisted background Apply transitions: reservations survive restart and all unsafe states fail closed before a click.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyStore} from '../../../lib/background-apply-store.js';

const config = {mode: 'auto', chosenAt: '2026-10-27T10:00:00Z', autoConfirmedAt: '2026-10-27T10:00:01Z', answers: 'facts', auto: {waitMin: 10}};
const ready = {answer: 'ready', step: 'final', submitControl: 'Send my application', requiredComplete: true, factsOnly: true, safe: true, botCheck: false, signature: 'page-1'};
function rig({now, realNow} = {}) {
  let time = Date.parse('2026-10-27T12:00:00Z'), id = 0, failed = false;
  const apps = new Map(), sections = new Map(), events = [];
  const call = async (_storage, entity, method, args) => {
    if (failed) throw new Error('store unavailable');
    if (entity === 'applications') {
      if (method === 'get') return apps.get(args.url) || null;
      if (method === 'list') return [...apps.values()];
      if (method === 'section') return sections.get(`${args.app_id}:${args.name}`) || '';
      if (method === 'set_section') { sections.set(`${args.app_id}:${args.name}`, args.markdown); return null; }
    }
    if (entity === 'matches' && method === 'get') return null;
    if (entity === 'events' && method === 'list') return events.filter(e => !args.kind || e.kind === args.kind);
    if (entity === 'events' && method === 'add') { const old = events.find(e => e.source_id === args.source_id); if (old) return old; const row = {...args, id: `e${++id}`}; events.push(row); return row; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  const make = () => createBackgroundApplyStore({}, {call, now: now || (() => time), realNow: realNow || (() => time), uuid: () => `attempt-${++id}`});
  const add = (suffix = '1', company = 'Fictional Cloud') => {
    const job = {id: `job-${suffix}`, url: `https://jobs.example.test/${suffix}`, fit: 90, company, stage: 'Kit ready'};
    apps.set(job.url, job);
    sections.set(`${job.id}:📝 Application kit`, '```json\n{"eligible":true,"answers":[]}\n```');
    return job;
  };
  return {make, add, apps, events, advance: ms => { time += ms; }, fail: () => { failed = true; }, setSection: (id, state) => sections.set(`${id}:Background Apply`, JSON.stringify(state)),
    setKit: (id, kit) => sections.set(`${id}:📝 Application kit`, kit === null ? '' : `\`\`\`json\n${JSON.stringify(kit)}\n\`\`\``)};
}
async function prepared(r, job = r.add(), mode = 'auto', opts = config) {
  const store = r.make(), row = await store.queue(job.url, `session-${job.id}`, mode, {...opts, mode});
  assert.equal((await store.claim(job.url, row.session, 'owned-browser')).ok, true);
  await store.ready(job.url, row.session, 'owned-browser', ready);
  return {store, job, session: row.session};
}

test('two launch claims and simultaneous reservations create exactly one owned session and submit attempt', async () => {
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', {...config, auto: {...config.auto, waitMin: 0}});
  assert.equal((await store.claim(job.url, session, 'other-browser')).ok, false);
  const args = [job.url, session, 'owned-browser', ready, {...config, auto: {...config.auto, waitMin: 0}}];
  const results = await Promise.all([store.reserve(...args), store.reserve(...args)]);
  assert.equal(results.filter(x => x.submit).length, 1);
  assert.equal(r.events.length, 1);
  assert.equal((await r.make().reserve(...args)).submit, false, 'restart never repeats an uncertain attempt');
});

test('Full automation honors only the queued explicit ineligible opt-in and always keeps stage proof', async () => {
  const explicit = rig(), explicitJob = explicit.add('explicit');
  explicit.setKit(explicitJob.id, {eligible: false, answers: []});
  const allowed = await prepared(explicit, explicitJob, 'auto', {...config, allowIneligible: true, auto: {waitMin: 0}});
  assert.equal((await allowed.store.read(explicitJob.url)).allowIneligible, true);
  assert.equal((await allowed.store.reserve(explicitJob.url, allowed.session, 'owned-browser', ready, {...config, auto: {waitMin: 0}})).submit, true,
    'the item keeps the opt-in it was queued with');

  const unknown = rig(), unknownJob = unknown.add('unknown');
  unknown.setKit(unknownJob.id, {answers: []});
  const unknownItem = await prepared(unknown, unknownJob, 'auto', {...config, allowIneligible: true, auto: {waitMin: 0}});
  const refused = await unknownItem.store.reserve(unknownJob.url, unknownItem.session, 'owned-browser', ready, {...config, auto: {waitMin: 0}});
  assert.equal(refused.submit, false, 'opt-in does not turn missing eligibility into eligible');
  assert.equal(refused.reason, 'not_eligible');

  const stage = rig(), stageJob = stage.add('stage');
  stage.setKit(stageJob.id, {eligible: false, answers: []});
  const stageItem = await prepared(stage, stageJob, 'auto', {...config, allowIneligible: true, auto: {waitMin: 0}});
  stage.apps.set(stageJob.url, {...stageJob, stage: 'Recruiter lead'});
  const stageRefused = await stageItem.store.reserve(stageJob.url, stageItem.session, 'owned-browser', ready, {...config, auto: {waitMin: 0}});
  assert.equal(stageRefused.submit, false, 'the opt-in never overrides a moved stage');
  assert.equal(stageRefused.reason, 'not_eligible');
});

test('the automatic press needs the judge to have said no bot check: a bot check, or no answer about it, never reserves', async () => {
  for (const botCheck of [true, undefined]) {
    const r = rig(), {store, job, session} = await prepared(r, r.add());
    r.advance(600000);
    const proof = {...ready, botCheck}, got = await store.reserve(job.url, session, 'owned-browser', proof, config);
    assert.equal(got.submit, false, `botCheck ${botCheck}`);
    assert.equal(got.reason, 'bot_check_unknown');
    assert.equal((await store.read(job.url)).state, 'needs_user_handoff', 'the person finishes it');
  }
});

// Why (13 Nov 2026, owner, LinkedIn Easy Apply: "4a fill, 4b send (Recommended)", asked via AskUserQuestion): Full automation fills a LinkedIn job to ready and the person sends it, until plan 4b.
test('a LinkedIn job is never reserved for an automatic press: the person finishes it', async () => {
  const r = rig(), job = r.add('li');
  r.apps.delete(job.url);
  const li = {...job, url: 'https://www.linkedin.com/jobs/view/4242'};
  r.apps.set(li.url, li);
  const {store, session} = await prepared(r, li, 'auto', {...config, auto: {waitMin: 0}});
  const got = await store.reserve(li.url, session, 'owned-browser', ready, {...config, auto: {waitMin: 0}});
  assert.equal(got.submit, false);
  assert.equal(got.reason, 'send_not_allowed_here');
  assert.equal((await store.read(li.url)).state, 'needs_user_handoff', 'the person finishes it');

  // Gitar on #4054: queued under another address, the page the judge saw is LinkedIn's.
  const s = rig(), {store: other, job: queued, session: otherSession} = await prepared(s, s.add('short'), 'auto', {...config, auto: {waitMin: 0}});
  const landed = await other.reserve(queued.url, otherSession, 'owned-browser', {...ready, page: 'https://www.linkedin.com/jobs/view/4242'}, {...config, auto: {waitMin: 0}});
  assert.equal(landed.reason, 'send_not_allowed_here', 'the page landed on LinkedIn');
});

test('mode 2 ends ready for review, while mode 3 waits and rechecks every guard before reserving', async () => {
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'fill');
  assert.equal((await store.read(job.url)).state, 'ready_for_review');
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, config)).submit, false);
  const second = await prepared(r, r.add('2', 'Other employer'));
  assert.equal((await second.store.reserve(second.job.url, second.session, 'owned-browser', ready, config)).reason, 'waiting');
  r.advance(600000);
  assert.equal((await second.store.reserve(second.job.url, second.session, 'owned-browser', ready, config)).submit, true);
});

test('CAPTCHA preflight and runtime handoffs survive store recreation, solved challenges and a changed mode', async () => {
  for (const reason of ['captcha_preflight', 'captcha_runtime']) {
    const r = rig(), job = r.add(), store = r.make();
    const row = await store.queue(job.url, 'captcha-session', 'auto', config);
    await store.claim(job.url, row.session, 'owned-browser');
    await store.handoff(job.url, row.session, 'owned-browser', reason);
    const restarted = r.make();
    assert.equal((await restarted.queue(job.url, 'new-session', 'auto', config)).session, row.session);
    assert.equal((await restarted.ready(job.url, row.session, 'owned-browser', ready)).state, 'manual_submit_required');
    assert.equal((await restarted.reserve(job.url, row.session, 'owned-browser', ready, config)).submit, false);
    assert.equal((await restarted.read(job.url)).manualOverride, true);
  }
});

// Why (7 Nov 2026, owner, #3363): the item's own confirmation decides, not Settings at press time: an item queued without one is handed over, never pressed, whatever Settings says now.
test('the page proof, the batch\'s own confirmation, eligibility and Stop cannot be bypassed', async () => {
  for (const kind of ['required', 'unsafe', 'optin', 'eligible', 'stop']) {
    const r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', kind === 'optin' ? {...config, autoConfirmedAt: ''} : config);
    r.advance(600000);
    let proof = {...ready}, current = structuredClone(config);
    if (kind === 'required') proof.requiredComplete = false;
    if (kind === 'unsafe') proof.safe = false;
    if (kind === 'eligible') r.apps.get(job.url).stage = 'Applied';
    if (kind === 'stop') await store.handoff(job.url, session, 'owned-browser', 'stopped');
    assert.equal((await store.reserve(job.url, session, 'owned-browser', proof, current)).submit, false, kind);
  }
});

// Owner, 7 Nov 2026, #3363: "The batch should continue with the setting it was set once the batch has been started." A Settings change after the queue moves nothing; the item's own mode and confirmation press.
test('a queued Full automation item reserves its press whatever Settings says now; one queued beside it in Fill never presses, and its confirmation is its own', async () => {
  const r = rig(), auto = await prepared(r, r.add(), 'auto', {...config, auto: {...config.auto, waitMin: 0}});
  const fill = await prepared(r, r.add('fill'), 'fill', {...config, mode: 'fill'});
  const now = {mode: 'fill', chosenAt: '2026-11-07T10:00:00Z', autoConfirmedAt: '', auto: {waitMin: 0}};   // Settings changed to Fill after both were queued
  assert.equal((await auto.store.reserve(auto.job.url, auto.session, 'owned-browser', ready, now)).submit, true, 'the batch keeps the mode it started with');
  assert.equal((await fill.store.reserve(fill.job.url, fill.session, 'owned-browser', ready, {...now, mode: 'auto', autoConfirmedAt: '2026-11-07T10:00:00Z'})).submit, false, 'Settings turning to Full automation later does not turn a Fill item into one');
});

// Code review (7 Nov 2026, #3363): queue() answers a live item with the old one; an old Full automation item that can still press must not be answered for a batch naming Fill.
test('a new batch in Fill for a job still queued for Full automation is refused; after Stop it starts afresh; the other direction is safe', async () => {
  const r = rig(), full = await prepared(r, r.add(), 'auto');
  await assert.rejects(() => full.store.queue(full.job.url, 'again', 'fill', {...config, mode: 'fill'}), error => error.code === 'LIVE_AUTO' && /already queued for Full automation/.test(error.message));
  await full.store.handoff(full.job.url, full.session, 'owned-browser', 'stopped');
  assert.equal((await full.store.queue(full.job.url, 'later', 'fill', {...config, mode: 'fill'})).mode, 'fill', 'stopped: the run ended, a new one starts in the batch\'s own mode');
  const fill = await prepared(r, r.add('fill'), 'fill', {...config, mode: 'fill'});
  assert.equal((await fill.store.queue(fill.job.url, 'again', 'auto', config)).mode, 'fill', 'an old Fill item stays Fill and never presses');
});

test('no user check holds a submit: unknown facts, a fit of 10, a full day and the same employer still reserve (the checks are gone)', async () => {
  const r = rig(), {store, job, session} = await prepared(r);
  r.apps.set('other', {id: 'done', company: job.company, stage: 'Applied', applied_on: '2026-10-27'});
  r.apps.get(job.url).fit = 10;
  r.advance(600000);
  assert.equal((await store.reserve(job.url, session, 'owned-browser', {...ready, factsOnly: false}, config)).submit, true);
});

test('receipt requires a matching recorded attempt; filled or unknown response never becomes Applied', async () => {
  const r = rig(), {store, job, session} = await prepared(r);
  assert.equal((await store.receipt(job.url, session, 'made-up', true)).ok, false);
  r.advance(600000);
  const attempt = await store.reserve(job.url, session, 'owned-browser', ready, config);
  assert.equal((await store.receipt(job.url, session, attempt.attempt, false)).state, 'needs_user_handoff');
  assert.equal((await r.make().reserve(job.url, session, 'owned-browser', ready, config)).submit, false);
  assert.equal((await store.receipt(job.url, session, attempt.attempt, true)).state, 'receipt_confirmed', 'a late genuine receipt can settle the recorded attempt');
});

test('a store outage authorizes neither browser launch nor submission', async () => {
  const r = rig(), job = r.add(); r.fail();
  await assert.rejects(r.make().queue(job.url, 's', 'auto', config), /store unavailable/);
});

test('a final clean step keeps the record of unknown facts seen on an earlier step (the record stays; no submit gate reads it)', async () => {
  const r = rig(), job = r.add(), store = r.make();
  const state = await store.queue(job.url, 'steps', 'auto', config);
  await store.claim(job.url, state.session, 'owned-browser');
  await store.checkpoint(job.url, state.session, 'owned-browser', {...ready, step: 'middle', factsOnly: false});
  const final = await store.ready(job.url, state.session, 'owned-browser', ready);
  assert.equal(final.factsOnly, false);
  r.advance(600000);
  const result = await store.reserve(job.url, state.session, 'owned-browser', ready, config);
  assert.equal(result.submit, true, 'the facts record does not hold the submit any more');
  assert.equal((await store.read(job.url)).factsOnly, false, 'the record itself is kept');
});

test('Stop or a mode change on a queued job hands it to the person before any browser claims it', async () => {
  const r = rig(), job = r.add(), store = r.make();
  const row = await store.queue(job.url, 'session-queued', 'fill', {...config, mode: 'fill'});   // bot review on #2324: queued has no owner yet
  const stopped = await store.handoff(job.url, row.session, 'owned-browser', 'stopped');
  assert.equal(stopped.state, 'needs_user_handoff');
  assert.equal(stopped.manualOverride, true);
  assert.equal((await store.claim(job.url, row.session, 'owned-browser')).ok, false, 'a stopped job is never claimed and filled later');
});

test('a ready final form keeps the page\'s own sending button, which the person\'s Submit in the live view presses', async () => {
  const r = rig(), {store, job} = await prepared(r, r.add('fill'), 'fill', {...config, mode: 'fill'});
  const state = await store.read(job.url);
  assert.deepEqual([state.state, state.submitControl], ['ready_for_review', 'Send my application']);
});

test('queue refuses a Recruiter lead with a typed not-eligible error, and accepts a job with no stage yet (the picker\'s rule)', async () => {
  const r = rig(), store = r.make();
  const lead = r.add('lead'); lead.stage = 'Recruiter lead';
  await assert.rejects(() => store.queue(lead.url, 's-lead', 'fill', {...config, mode: 'fill'}), error => error.code === 'NOT_ELIGIBLE' && /not eligible to start another application/.test(error.message));
  const unstaged = r.add('none'); unstaged.stage = '';
  assert.equal((await store.queue(unstaged.url, 's-none', 'fill', {...config, mode: 'fill'})).state, 'queued');
  const strict = r.add('strict'); strict.stage = '';
  await assert.rejects(() => store.queue(strict.url, 's-strict', 'auto', {...config, mode: 'auto'}), error => error.code === 'NOT_ELIGIBLE', 'Full automation never queues a job with no stage: its submit gate would refuse it');
});

// Why (2026-10-29, owner: "by default, we should go with no" wait): one default for the wait, none (0); a config that does not name it gets AUTO_DEFAULTS.waitMin, in the store and in the controller alike.
test('with no wait saved the press is due at once: the shared default is no wait (optional in Settings → Apply)', async () => {
  const {AUTO_DEFAULTS} = await import('../../../renderer/apply-settings-model.js');
  assert.equal(AUTO_DEFAULTS.waitMin, 0);
  const unset = {...config, auto: {...config.auto, waitMin: undefined}};
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', unset);
  const now = await store.reserve(job.url, session, 'owned-browser', ready, unset);
  assert.equal(now.submit, true, 'no wait: the checks decide at once, not after a fallback wait');
});

// Crash rule (owner, 29 Oct 2026: a job left in "submitting" after a quit is handed over, never retried): the hidden browser dies with the app, so a press in flight has no receipt to wait for.
test('a press interrupted by a quit becomes "check whether it went through", whatever browser owned it, and is never reserved again', async () => {
  const waitNow = {...config, auto: {...config.auto, waitMin: 0}}, r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', waitNow);
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, waitNow)).submit, true, 'the press was reserved');
  const restarted = r.make();   // a new run of the app: no browser owns anything
  const state = await restarted.interrupted(job.url, session);
  assert.equal(state.state, 'needs_user_handoff');
  assert.equal(state.reason, 'submission_outcome_unknown');
  assert.equal(state.manualOverride, true);
  assert.equal((await restarted.reserve(job.url, session, 'new-browser', ready, waitNow)).submit, false, 'a second attempt never goes out');
  assert.equal(await restarted.interrupted(job.url, session), null, 'once handed over, nothing is interrupted again');
});

test('a job that was not mid-press, or already has its receipt, is left alone by the interrupted check', async () => {
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto');
  assert.equal(await store.interrupted(job.url, session), null, 'waiting to submit is not an interrupted press');
  assert.equal(await store.interrupted(job.url, 'someone-else'), null, 'another session\'s record is not touched');
});

// A press whose reply never arrives (the extension closed, the app still open): the app hands it over itself once the wait is up.
test('a press with no receipt after the wait is handed to the person; a younger one is left alone', async () => {
  const waitNow = {...config, auto: {...config.auto, waitMin: 0}}, r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', waitNow);
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, waitNow)).submit, true, 'the press was reserved');
  r.advance(2 * 60000);
  assert.equal(await store.interrupted(job.url, session, {afterMs: 3 * 60000}), null, '2 minutes after the press is still within the wait for a reply');
  assert.equal((await store.read(job.url)).state, 'submitting');
  r.advance(60000);
  const state = await store.interrupted(job.url, session, {afterMs: 3 * 60000});
  assert.equal(state.state, 'needs_user_handoff');
  assert.equal(state.reason, 'submission_outcome_unknown');
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, waitNow)).submit, false, 'never pressed again');
});

// A quit is a Stop (owner, 30 Oct 2026, after #2598's restart step saw Full automation press 80 s after a restart on the wait the quit cut off).
test('a job a quit caught before its press (waiting, ready for review, filling) goes to the person as app_closed, whatever browser owned it, and is never pressed', async () => {
  const r = rig(), waiting = await prepared(r, r.add('w'), 'auto'), held = await prepared(r, r.add('f', 'Other employer'), 'fill');
  const filling = r.make(), job = r.add('q', 'Third employer'), row = await filling.queue(job.url, 'session-q', 'fill', {...config, mode: 'fill'});
  assert.equal((await filling.claim(job.url, row.session, 'owned-browser')).ok, true);
  r.advance(600000);   // the wait ran out while the app was closed
  const restarted = r.make();
  for (const [url, session, was] of [[waiting.job.url, waiting.session, 'waiting_to_submit'], [held.job.url, held.session, 'ready_for_review'], [job.url, row.session, 'preflight']]) {
    assert.equal((await restarted.read(url)).state, was, `positive control: the quit caught it in ${was}`);
    assert.equal(await restarted.interrupted(url, session), null, `without quit, ${was} is not an interrupted press`);
    const state = await restarted.interrupted(url, session, {quit: true});
    assert.equal(state.state, 'needs_user_handoff', was);
    assert.equal(state.reason, 'app_closed', was);
    assert.equal(state.manualOverride, true, was);
    assert.equal(await restarted.interrupted(url, session, {quit: true}), null, `${was}: once handed over, nothing is handed over again`);
  }
  assert.equal((await restarted.reserve(waiting.job.url, waiting.session, 'owned-browser', ready, config)).submit, false, 'the wait the quit cut off never presses');
});


test('the Full automation clock refuses an offset outside JOBADABRA_E2E', async () => {
  const {createBackgroundWaitClock} = await import('../../../lib/background-apply-clock.js');
  for (const env of [{}, {JOBADABRA_E2E: '0'}, {JOBADABRA_E2E: 'true'}]) {
    const clock = createBackgroundWaitClock({env, wallNow: () => 1000});
    assert.throws(() => clock.moveTo(601000), /e2e only/);
    assert.equal(clock.now(), 1000, 'a refused offset never changes the production clock');
  }
});

test('the e2e wait clock advances once, follows wall time and never moves backward', async () => {
  const {createBackgroundWaitClock} = await import('../../../lib/background-apply-clock.js');
  let wall = 1000;
  const env = {JOBADABRA_E2E: '1'}, clock = createBackgroundWaitClock({env, wallNow: () => wall});
  assert.equal(clock.moveTo(61000), 61000);
  wall += 10;
  assert.equal(clock.now(), 61010);
  for (const at of [NaN, Infinity, -1]) assert.throws(() => clock.moveTo(at), /forward/);
  for (const at of [0, 61000]) assert.equal(clock.moveTo(at), 61010);
  env.JOBADABRA_E2E = '0';
  assert.equal(clock.now(), wall, 'an offset is ignored without the e2e gate');
});


test('a human receipt on a later job uses real time after the wait clock moved', async () => {
  let wall = 1000000, offset = 20 * 60000;
  const r = rig({now: () => wall + offset, realNow: () => wall});
  const {store, job, session} = await prepared(r, r.add(), 'fill', {...config, mode: 'fill'});
  wall += 100;
  assert.equal((await store.humanReceipt(job.url, session, 'owned-browser', wall)).state, 'receipt_confirmed');
  assert.equal((await store.read(job.url)).receiptAt, wall, 'a human receipt carries real time');
  const later = await prepared(r, r.add('later'), 'fill', {...config, mode: 'fill'});
  assert.equal((await later.store.humanReceipt(later.job.url, later.session, 'owned-browser', wall - 1)).ok, false, 'a press before this queue is still refused');
  offset += 60000;
  wall += 16 * 60000;
  assert.equal((await later.store.humanReceipt(later.job.url, later.session, 'owned-browser', wall - 16 * 60000)).ok, false, 'an old real press is still refused');
});

// Why (5 Nov 2026, owner's screenshot: a Full automation batch showed Lufthansa "Needs you · Try again" and GLOCK as "Background automation"): both jobs had an
// earlier run's hand-off, and queue returned it, so the new run never launched and kept the old mode (spec 2026-11-05-applying-redesign.md). The run through the
// controller and its poll: background-apply-controller.test.js.
test('a job applied to again after Stop, Cancel, a quit or a mode change starts a new run in the new mode; every other hand-off stays with the person', async () => {
  for (const reason of ['stopped', 'cancelled', 'app_closed', 'mode_changed']) {
    const r = rig(), job = r.add(), store = r.make();
    const first = await store.queue(job.url, 'old-run', 'fill', {...config, mode: 'fill'});
    await store.claim(job.url, first.session, 'owned-browser');
    await store.handoff(job.url, first.session, 'owned-browser', reason);
    const again = await r.make().queue(job.url, 'new-run', 'auto', config);
    assert.deepEqual([again.session, again.state, again.mode, again.manualOverride, again.reason ?? ''], ['new-run', 'queued', 'auto', false, ''], `${reason}: a new run`);
    assert.equal((await r.make().claim(job.url, 'new-run', 'owned-browser')).ok, true, `${reason}: the new run launches`);
  }
  // Open in my browser / review requested: the person may have submitted it themselves; a bot check, an unknown press, a page that needs the person: theirs to settle.
  for (const reason of ['opened_in_browser', 'review_requested', 'captcha_preflight', 'captcha_runtime', 'submission_outcome_unknown', 'bot_check_unknown', 'sign_in_required', 'needs_user', 'attempt_already_reserved']) {
    const r = rig(), job = r.add(), store = r.make();
    const first = await store.queue(job.url, 'held', 'auto', config);
    await store.claim(job.url, first.session, 'owned-browser');
    await store.handoff(job.url, first.session, 'owned-browser', reason);
    const again = await r.make().queue(job.url, 'new-run', 'auto', config);
    assert.deepEqual([again.session, again.reason, again.manualOverride], ['held', reason, true], `${reason}: kept for the person`);
  }
});

test('a job whose press was reserved never starts over, even when a Stop saved its hand-off without the attempt', async () => {
  const r = rig(), {store, job, session} = await prepared(r);
  r.advance(600000);
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, config)).submit, true);
  await store.handoff(job.url, session, 'owned-browser', 'stopped');
  assert.ok((await r.make().queue(job.url, 'new-run', 'auto', config)).attempt, 'the attempt on the state');
  const s2 = r.make(), j2 = r.add('2'), p2 = await prepared(r, j2);
  r.advance(600000);
  assert.equal((await p2.store.reserve(j2.url, p2.session, 'owned-browser', ready, config)).submit, true);
  const app = r.apps.get(j2.url);
  // A state saved from before the reservation (what a Stop racing the press writes): no attempt, reason stopped, but the reservation event stands.
  const raw = {version: 1, session: p2.session, mode: 'auto', chosenAt: config.chosenAt, state: 'needs_user_handoff', manualOverride: true, reason: 'stopped', owner: 'owned-browser'};
  r.setSection(app.id, raw);
  assert.equal((await s2.queue(j2.url, 'new-run', 'auto', config)).session, p2.session, 'the reservation event keeps the old run');
});
