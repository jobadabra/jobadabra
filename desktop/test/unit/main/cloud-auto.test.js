// The Mac's side of Full automation in the cloud (lib/cloud-auto.js, cloud browser runner cs 4/4, spec "cs 4/4 Design"): what is sent when the Mac goes away, what happens when the site refuses or does not answer,
// and how the site's outcomes come back. Guard: safety (never a double send: an item is marked sent before the site hears of it, and only a refusal that says "not queued" puts it back).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCloudAuto} from '../../../lib/cloud-auto.js';

const T0 = Date.parse('2026-11-10T21:00:00Z');   // clock: fixed fixture time; the test hands every clock to the module
function rig({sites = {}, skipCode: firstSkip = '', eligible = true, takeFails = 0} = {}) {
  let failing = takeFails, skipCode = firstSkip;
  const gone = new Set();   // sessions the store no longer holds as cloud items: the real side.take answers null for them
  let settings = {}, time = T0;
  const marks = [], calls = [], taken = [], applied = [], logs = [];
  const storage = {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; }};
  const entries = ['a', 'b'].map(name => ({session: `s-${name}`, url: `https://jobs.example.test/${name}`, title: `Job ${name}`, company: 'Fictional', state: {state: 'filling', mode: 'auto', chosenAt: '2026-11-10T09:00:00Z', autoConfirmedAt: '2026-11-10T09:00:01Z', queuedAt: T0 - 60000, allowIneligible: false}}));
  const sent = new Set(), closed = [];
  const side = {
    candidates: async () => entries.map(entry => ({...entry, state: {...entry.state, state: sent.has(entry.session) ? 'cloud' : 'filling'}})),
    send: async session => { marks.push(`mark ${session}`); sent.add(session); return {state: 'cloud'}; },
    unsend: async session => { marks.push(`back ${session}`); sent.delete(session); return {state: 'filling'}; },
    closeLocal: async session => { closed.push(session); return true; },
    take: async (session, outcome) => { if (failing-- > 0) return {ok: false, retry: true}; if (gone.has(session)) return null; taken.push([session, outcome]); return {state: outcome.state === 'submitted' ? 'receipt_confirmed' : 'needs_user_handoff'}; },
  };
  const answer = (name, fallback) => async (...args) => { calls.push(name); marks.push(name); const own = sites[name]; return typeof own === 'function' ? own(...args) : own || fallback; };
  const site = {autoSend: async (_, batch) => { marks.push('post'); calls.push(['post', batch]); const own = sites.post; return typeof own === 'function' ? own(batch) : own || {ok: true, batch: 'b1', queued: batch.jobs.length}; },
    autoRun: answer('run', {ok: true}), autoStop: answer('stop-night', {ok: true}), stop: async (_, job) => { calls.push(['stop', job]); return sites.stop || {ok: true}; }, readTake: answer('take', {ok: true, reads: [], submits: [], pendingSubmits: 0})};
  const jobs = entries.map(entry => ({code: `code-${entry.url.slice(-1)}`, url: entry.url, title: entry.title, company: entry.company}));
  const build = async list => ({batch: {night: '2026-11-11', fillAt: 'x', contact: {name: 'Ada'}, facts: {}, jobs: list.filter(job => ![skipCode].flat().includes(job.code)).map(job => ({id: job.code, url: job.url, title: job.title, company: job.company, fit: 90, kit: {answers: []}, letter: '', cv: 'pdf', letterPdf: ''}))}, skipped: []});
  const auto = createCloudAuto({storage, eligible: () => eligible, side, jobs: () => jobs, build, kitInfo: async () => ({stage: 'Kit ready', eligible: true}), waitMin: () => 7, site, markApplied: async url => { applied.push(url); return {ok: true}; },
    now: () => new Date(time), log: (message, extra) => logs.push([message, extra]), });
  return {auto, storage, marks, calls, taken, gone, applied, closed, logs, skip: code => { skipCode = code; }, advance: ms => { time += ms; }, entries};
}
const batchOf = r => r.calls.find(call => call[0] === 'post')[1];

test('the Mac going away sends each item with its own stamp; it marks them sent before the site hears, and the hidden tabs close after the start', async () => {
  const r = rig();
  const done = await r.auto.handOver('the app quits');
  assert.deepEqual([done.ok, done.sent], [true, 2]);
  assert.deepEqual(r.marks, ['mark s-a', 'mark s-b', 'post', 'run'], 'marked before the post, started after it');
  const batch = batchOf(r);
  assert.equal(batch.task, undefined, 'the site\'s own field is added by lib/ready-site.js');
  assert.equal(batch.night, '2026-11-10', 'the UTC day, as the readiness night');
  const first = batch.jobs[0];
  assert.deepEqual(first.item, {job: 'code-a', url: first.url, session: 's-a', state: 'queued', manualOverride: false, mode: 'auto', chosenAt: '2026-11-10T09:00:00Z', autoConfirmedAt: '2026-11-10T09:00:01Z', queuedAt: T0 - 60000, waitMin: 7, allowIneligible: false});
  assert.deepEqual([first.stage, first.kit.eligible], ['Kit ready', true]);
  assert.deepEqual(r.closed, ['s-a', 's-b']);
  assert.deepEqual(Object.keys(r.storage.settings().cloudAuto.sent), ['code-a', 'code-b']);
});

test('nothing is sent without Always on, with no item, or when today\'s night already started', async () => {
  const off = rig({eligible: false});
  assert.deepEqual(await off.auto.handOver('screen locked'), {skipped: 'not Always on'});
  assert.deepEqual(off.marks, []);
  const r = rig();
  await r.auto.handOver('the Mac sleeps');
  r.marks.length = 0;
  assert.deepEqual(await r.auto.handOver('the Mac sleeps'), {skipped: 'today\'s cloud night already started'});
  assert.deepEqual(r.marks, [], 'a second departure the same day neither marks nor posts: the items stay with the Mac');
});

test('a refusal that says the night was not queued puts every item back; an item with no kit is never sent half-made', async () => {
  const refused = rig({sites: {post: {ok: false, status: 402, error: 'Full automation from the cloud is part of Pro.'}}});
  const done = await refused.auto.handOver('the app quits');
  assert.equal(done.status, 402);
  assert.deepEqual(refused.marks, ['mark s-a', 'mark s-b', 'post', 'back s-a', 'back s-b']);
  assert.deepEqual(refused.storage.settings().cloudAuto.sent, {}, 'recorded before the post, taken back after the refusal: nothing is out');
  const half = rig({skipCode: 'code-b'});
  await half.auto.handOver('the app quits');
  assert.deepEqual(batchOf(half).jobs.map(job => job.id), ['code-a']);
  assert.deepEqual(half.marks.filter(mark => mark.startsWith('back')), ['back s-b'], 'the one not sent goes back to the Mac');
});

test('a send the site did not answer stays marked sent and is posted again, never put back: the site may hold it', async () => {
  let answers = [{ok: false, error: 'offline'}, {ok: false, status: 409, error: 'this night already started'}];
  const r = rig({sites: {post: () => answers.shift()}});
  const first = await r.auto.handOver('the Mac sleeps');
  assert.equal(first.uncertain, true);
  assert.equal(r.marks.some(mark => mark.startsWith('back')), false, 'never put back without the site\'s answer');
  assert.equal(r.storage.settings().cloudAuto.started, false);
  assert.equal(await r.auto.takeBack(), true, 'the retry');
  assert.equal(r.storage.settings().cloudAuto.started, true, '409 "already started" says the site has it');
  assert.equal(r.marks.filter(mark => mark === 'run').length, 0, 'a night the site already started is not started again');
});

test('a night that cannot be started is stopped on the site before the items go back; when it cannot be stopped they stay sent', async () => {
  const stopped = rig({sites: {run: {ok: false, status: 404, error: 'off'}}});
  await stopped.auto.handOver('the app quits');
  assert.deepEqual(stopped.marks.slice(-4), ['run', 'stop-night', 'back s-a', 'back s-b']);
  const stuck = rig({sites: {run: {ok: false, status: 404, error: 'off'}, 'stop-night': {ok: false, error: 'offline'}}});
  const done = await stuck.auto.handOver('the app quits');
  assert.equal(done.uncertain, true);
  assert.equal(stuck.marks.some(mark => mark.startsWith('back')), false);
});

test('an outcome is kept before it is written, written once, and a receipt marks the job Applied', async () => {
  const r = rig();
  await r.auto.handOver('the app quits');
  const submits = [{job: 'code-a', night: '2026-11-10', state: 'submitted', why: '', outcome: {attempt: 'att-1'}, ms: 5000}, {job: 'code-b', night: '2026-11-10', state: 'not_submitted', why: 'not_eligible', outcome: {}, ms: 1}, {job: 'other', night: '2026-11-10', state: 'submitted', why: '', outcome: {}, ms: 1}];
  await r.auto.heard({ok: true, submits});
  assert.deepEqual(r.taken, [['s-a', {state: 'submitted', attempt: 'att-1', reason: 'needs_user'}], ['s-b', {state: 'not_submitted', attempt: '', reason: 'not_eligible'}]]);
  assert.deepEqual(r.applied, ['https://jobs.example.test/a'], 'only the receipt');
  assert.deepEqual(r.storage.settings().cloudAuto.sent, {}, 'both items are done');
  assert.deepEqual(r.storage.settings().cloudAuto.inbox, [], 'nothing waits to be written');
  assert.ok(r.logs.some(([message]) => /for no item of this Mac/.test(message)));
});

// Why (#3815): side.take never throws; it answers {ok: false, retry: true} when the store write failed and null when the item is gone. The old fake threw, which the real side never does, so the bug passed.
test('a failed store write keeps the outcome and its item for the next takeBack (the real side.take answer, not a throw)', async () => {
  const r = rig({takeFails: 1});
  await r.auto.handOver('the app quits');
  await r.auto.heard({ok: true, submits: [{job: 'code-a', night: '2026-11-10', state: 'submitted', why: '', outcome: {attempt: 'att-1'}, ms: 1}]});
  assert.equal(r.applied.length, 0);
  assert.equal(r.storage.settings().cloudAuto.inbox.length, 1, 'the outcome is kept');
  assert.ok(r.storage.settings().cloudAuto.sent['code-a'], 'its item is still out');
  await r.auto.takeBack();
  assert.equal(r.applied.length, 1, 'the receipt is recorded once the write works');
  assert.deepEqual(r.storage.settings().cloudAuto.inbox, []);
  assert.equal(r.storage.settings().cloudAuto.sent['code-a'], undefined);
});

test('an outcome for an item the store no longer holds as a cloud item is dropped', async () => {
  const r = rig();
  await r.auto.handOver('the app quits');
  r.gone.add('s-a');
  await r.auto.heard({ok: true, submits: [{job: 'code-a', night: '2026-11-10', state: 'submitted', why: '', outcome: {attempt: 'att-1'}, ms: 1}]});
  assert.deepEqual(r.storage.settings().cloudAuto.inbox, []);
  assert.equal(r.storage.settings().cloudAuto.sent['code-a'], undefined);
  assert.equal(r.applied.length, 0);
});

test('the give-up after 5 minutes keeps the item when the store write fails, and ends it when the write works', async () => {
  const r = rig({takeFails: 1});
  await r.auto.handOver('the app quits');
  r.advance(6 * 60000);
  await r.auto.takeBack();
  assert.deepEqual(Object.keys(r.storage.settings().cloudAuto.sent), ['code-a'], 'the failed write keeps code-a; code-b ended as unknown');
  await r.auto.takeBack();
  assert.deepEqual(r.taken.map(([session, outcome]) => [session, outcome.state]), [['s-b', 'unknown'], ['s-a', 'unknown']]);
  assert.deepEqual(r.storage.settings().cloudAuto.sent, {});
});

test('a wait with no news is told as unknown after 5 minutes, never as "not sent"', async () => {
  const r = rig();
  await r.auto.handOver('the app quits');
  r.advance(60000);
  assert.equal(await r.auto.takeBack(), true, 'a minute in, the site reports nothing left and no outcome: still waiting');
  assert.equal(r.taken.length, 0);
  r.advance(5 * 60000);
  assert.equal(await r.auto.takeBack(), false);
  assert.deepEqual(r.taken.map(([, outcome]) => outcome.state), ['unknown', 'unknown']);
});

test('the person\'s Stop reaches the site for that job only, by session or by address', async () => {
  const r = rig();
  await r.auto.handOver('the app quits');
  assert.equal(await r.auto.stopFor('s-b'), true);
  assert.equal(await r.auto.stopForUrl('https://jobs.example.test/a'), true);
  assert.equal(await r.auto.stopFor('s-none'), false);
  assert.deepEqual(r.calls.filter(call => call[0] === 'stop'), [['stop', 'code-b'], ['stop', 'code-a']]);
});

test('code review: the item is recorded before the site hears of it; a build that throws puts them back; nothing alarms after a Stop; "already" is no end', async () => {
  let seenAtPost = null;
  const r = rig({sites: {post: batch => { seenAtPost = Object.keys(r.storage.settings().cloudAuto?.sent || {}); return {ok: true, batch: 'b', queued: batch.jobs.length}; }}});
  await r.auto.handOver('the app quits');
  assert.deepEqual(seenAtPost, ['code-a', 'code-b'], 'recorded before the post, so a cut-off quit strands nothing');
  assert.equal(r.storage.settings().cloudAuto.sent['code-a'].started, true);
  await r.auto.stopFor('s-a');   // the person's Stop
  assert.equal(r.storage.settings().cloudAuto.sent['code-a'].stopped, true, 'kept, flagged');
  r.advance(6 * 60000);
  await r.auto.takeBack();
  assert.deepEqual(r.taken.map(([session]) => session), ['s-b'], 'only the item nobody stopped is told as "check"; the stopped one raises no alarm');
  const held = rig();
  await held.auto.handOver('the app quits');
  await held.auto.heard({ok: true, submits: [{job: 'code-a', night: '2026-11-10', state: 'not_submitted', why: 'already', outcome: {}, ms: 1}]});
  assert.equal(held.taken.length, 0, 'another night holds this item: no end yet');
  assert.ok(held.storage.settings().cloudAuto.sent['code-a'], 'still waiting for the real outcome');
  await held.auto.heard({ok: true, submits: [{job: 'code-a', night: '2026-11-10', state: 'submitted', why: '', outcome: {attempt: 'att'}, ms: 1}]});
  assert.deepEqual(held.taken.map(([, outcome]) => outcome.state), ['submitted']);
});

test('code review: a build that throws and a night after midnight', async () => {
  const broken = rig();
  const failing = createCloudAuto({storage: broken.storage, eligible: () => true, side: {candidates: async () => broken.entries.map(entry => ({...entry})), send: async session => { broken.marks.push(`mark ${session}`); return {state: 'cloud'}; },
    unsend: async session => { broken.marks.push(`back ${session}`); return {}; }, closeLocal: async () => true, take: async () => ({})}, jobs: () => [{code: 'code-a', url: broken.entries[0].url}, {code: 'code-b', url: broken.entries[1].url}],
    build: async () => { throw new Error('facts unreadable'); }, kitInfo: async () => ({}), waitMin: () => 0, site: {}, markApplied: async () => ({}), now: () => new Date(T0)});
  const done = await failing.handOver('the app quits');
  assert.equal(done.ok, false);
  assert.deepEqual(broken.marks, ['mark s-a', 'mark s-b', 'back s-a', 'back s-b'], 'nothing was posted: both back');
  const r = rig();
  await r.auto.handOver('the app quits');
  r.advance(24 * 3600000);   // the next UTC day: the cloud still runs both, so they are never posted in a second night
  r.marks.length = 0;
  assert.deepEqual(await r.auto.handOver('the app quits'), {skipped: 'no Full automation item the jobs list holds'});
  assert.deepEqual(r.marks, []);
});

// Why (retro review of #3697, Gitar, 10 Nov 2026): an item left in 'cloud' by an earlier send the site never answered, whose kit is gone at the retry, stayed 'cloud' for good: the Mac never pressed it, the site never got it.
test('retro #3697: an item already in the cloud whose kit is gone at the retry is stopped on the site and handed back to the Mac, never left stranded', async () => {
  let answers = [{ok: false, error: 'offline'}, {ok: true, batch: 'b2', queued: 1}];
  const r = rig({sites: {post: () => answers.shift()}});
  assert.equal((await r.auto.handOver('the Mac sleeps')).uncertain, true);   // both items are out, the site's answer was lost
  r.skip('code-b');   // its kit or CV file is gone now
  r.marks.length = 0; r.calls.length = 0;
  await r.auto.takeBack();
  assert.deepEqual(r.calls.filter(call => call[0] === 'stop'), [['stop', 'code-b']], 'the earlier post may have queued it: the site is told to drop it first');
  assert.deepEqual(r.marks.filter(mark => mark.startsWith('back')), ['back s-b'], 'then it goes back to the Mac');
  assert.deepEqual(Object.keys(r.storage.settings().cloudAuto.sent), ['code-a'], 'only the item the site holds is out');
});

test('retro #3697: when the site does not confirm the Stop (404 "nothing is filling" is also a finished night) the item stays out and the wait ends as "check": never a second press, never stranded', async () => {
  let answers = [{ok: false, error: 'offline'}, {ok: true, batch: 'b2', queued: 1}];
  const r = rig({sites: {post: () => answers.shift(), stop: {ok: false, status: 404, error: 'nothing is filling'}}});
  await r.auto.handOver('the Mac sleeps');
  r.skip('code-b');
  r.marks.length = 0;
  await r.auto.takeBack();
  assert.equal(r.marks.some(mark => mark.startsWith('back')), false, 'not handed back while the site may still hold it');
  assert.equal(r.storage.settings().cloudAuto.sent['code-b'].started, true, 'out, so it is no longer retried');
  r.advance(6 * 60000);
  await r.auto.takeBack();
  assert.deepEqual(r.taken.filter(([session]) => session === 's-b').map(([, outcome]) => outcome.state), ['unknown'], 'told as "check"');
});

test('retro #3697: when every held item lost its kit and the site cannot confirm, the retry does not loop on the Stop; the wait ends as "check"', async () => {
  const r = rig({sites: {post: {ok: false, error: 'offline'}, stop: {ok: false, status: 404, error: 'nothing is filling'}}});
  await r.auto.handOver('the Mac sleeps');
  r.skip(['code-a', 'code-b']);
  r.calls.length = 0;
  assert.equal(await r.auto.takeBack(), true);
  assert.equal(await r.auto.takeBack(), true);
  assert.equal(r.calls.filter(call => call[0] === 'stop').length, 2, 'one Stop per item on the first retry, none on the second');
  r.advance(6 * 60000);
  assert.equal(await r.auto.takeBack(), false);
  assert.deepEqual(r.taken.map(([, outcome]) => outcome.state), ['unknown', 'unknown']);
});
