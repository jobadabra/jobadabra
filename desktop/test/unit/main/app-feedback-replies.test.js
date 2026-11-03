// The owner's answer to a feedback comes back to the app that sent it (lib/app-feedback-replies.js): one card per answer with when the fix arrives, closed once, nothing when offline.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {arrival, closeReply, fetchReplies, registerReplies} from '../../../lib/app-feedback-replies.js';

const KEY = 'JPF1.install-0001-abcd.tok';
const store = (secrets = {JOBADABRA_TRIAL_KEY: KEY}) => { const mine = {telemetryId: 'install-0001-abcd'}; return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch), secret: name => secrets[name] || ''}; };
const reply = (more = {}) => ({ref: 'a1b2c3d4e5f60718', on: '2026-10-28', excerpt: 'The CV upload hangs on a big file', kind: 'fixed', fixedIn: '0.9.12', message: 'Fixed in 0.9.12. Thank you for telling us.', ...more});
const answers = body => async () => Response.json({ok: true, ...body});

test('arrival says whether the fix is here, coming, or comes with the next update', () => {
  assert.equal(arrival(reply(), '0.9.11'), 'It arrives in 0.9.12.');
  assert.equal(arrival(reply(), '0.9.12'), 'Fixed in 0.9.12: you have it.');
  assert.equal(arrival(reply({fixedIn: '0.9.12 (beta)'}), '0.9.0'), 'It arrives in 0.9.12.');
  assert.equal(arrival(reply({fixedIn: ''}), '0.9.11'), 'It arrives with the next update.');
  assert.equal(arrival(reply({kind: 'deferred'}), '0.9.11'), '', 'a "not now" has no arrival');
  assert.equal(arrival(reply({fixedIn: '0.9.12 (beta)'}), '0.9.12-alpha.5'), 'Fixed in 0.9.12: you have it.', 'a test build of that version counts as having it');
});

test('the app asks with its own key (never just the install id) and gets cards with their arrival line', async () => {
  let asked = '', sent = {};
  const cards = await fetchReplies(store(), {version: '0.9.11', fetcher: async (url, init) => { asked = url; sent = init.headers; return Response.json({ok: true, replies: [reply(), reply({ref: 'ffffeeee00001111', kind: 'deferred', fixedIn: ''})]}); }});
  assert.match(asked, /\/api\/feedback\/replies$/);
  assert.deepEqual(sent, {'x-api-key': KEY});
  assert.deepEqual(cards.map(card => [card.ref, card.kind, card.arrival]), [['a1b2c3d4e5f60718', 'fixed', 'It arrives in 0.9.12.'], ['ffffeeee00001111', 'deferred', '']]);
});

test('offline, refused or an answer in another shape: no card, no throw, and the caller is told it did not get an answer (null), not "nothing waiting" ([])', async () => {
  const st = store();
  assert.equal(await fetchReplies(st, {fetcher: async () => { throw new Error('offline'); }}), null);
  assert.equal(await fetchReplies(st, {fetcher: async () => new Response('no', {status: 429})}), null);
  assert.equal(await fetchReplies(st, {fetcher: answers({replies: 'x'})}), null);
  assert.deepEqual(await fetchReplies(st, {fetcher: answers({replies: [null, {ref: 5}, {message: 'no ref'}]})}), []);
  assert.deepEqual(await fetchReplies(st, {fetcher: answers({replies: []})}), []);
});

test('a date that is not a date is dropped, so the card still draws', async () => {
  const cards = await fetchReplies(store(), {fetcher: answers({replies: [reply({on: 'junk-date!'}), reply({ref: 'ffffeeee00001111', on: '2026-10-28'})]})});
  assert.deepEqual(cards.map(card => card.on), ['', '2026-10-28']);
});

test('without a key nothing is asked or posted; closing posts the ref with the key and reports whether the site took it', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, JSON.parse(init.body), init.headers['x-api-key']]); return new Response('{}', {status: 200}); };
  assert.equal(await fetchReplies(store({}), {fetcher: async () => { throw new Error('must not ask'); }}), null);
  assert.equal(await closeReply(store({}), 'x', {fetcher}), false);
  assert.equal(calls.length, 0);
  assert.equal(await closeReply(store(), 'a1b2c3d4e5f60718', {fetcher}), true);
  assert.match(calls[0][0], /\/replies\/seen$/);
  assert.deepEqual([calls[0][1], calls[0][2]], [{ref: 'a1b2c3d4e5f60718'}, KEY]);
  assert.equal(await closeReply(store(), 'x', {fetcher: async () => { throw new Error('offline'); }}), false);
});

test('the handlers ask the site at most every 6 hours, drop a closed card at once and say nothing in demo mode', async () => {
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }}, app = {getVersion: () => '0.9.11'};
  let gets = 0, clock = 1_000, closed = [];
  const fetcher = async (url, init) => { if (init?.method === 'POST') { closed.push(JSON.parse(init.body).ref); return new Response('{}'); } gets++; return Response.json({ok: true, replies: [reply()]}); };
  registerReplies({DEMO: false, app, ipcMain, storage: store(), fetcher, now: () => clock});
  assert.equal((await handlers.feedbackReplies()).length, 1);
  await handlers.feedbackReplies();
  assert.equal(gets, 1, 'a second call inside 6 hours uses the cards held');
  await handlers.feedbackReplyClose({}, 'a1b2c3d4e5f60718');
  assert.deepEqual([closed, (await handlers.feedbackReplies()).length], [['a1b2c3d4e5f60718'], 0]);
  clock += 6 * 3600 * 1000;
  assert.equal((await handlers.feedbackReplies()).length, 0, 'after 6 hours it asks again, and the card the person closed is not drawn again');
  assert.equal(gets, 2);
  const demo = {};
  registerReplies({DEMO: true, app, ipcMain: {handle: (name, fn) => { demo[name] = fn; }}, storage: store(), fetcher, now: () => clock});
  assert.deepEqual(await demo.feedbackReplies(), []);
});

test('a failed ask (offline, or the trial key not minted yet) is tried again within the hour, not after 6 hours', async () => {
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }}, app = {getVersion: () => '0.9.11'}, secrets = {};
  const st = {...store(), secret: name => secrets[name] || ''};
  let clock = 1_000, gets = 0;
  const fetcher = async () => { gets++; return Response.json({ok: true, replies: [reply()]}); };
  registerReplies({DEMO: false, app, ipcMain, storage: st, fetcher, now: () => clock});
  assert.deepEqual(await handlers.feedbackReplies(), [], 'no key yet: nothing asked');
  assert.equal(gets, 0);
  secrets.JOBADABRA_TRIAL_KEY = KEY; clock += 20 * 60 * 1000;
  assert.equal((await handlers.feedbackReplies()).length, 1, '20 minutes later the key exists and the answer comes');
});

test('a card the person closed stays closed even when the post failed: it is not drawn again and the post is retried at the next ask', async () => {
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }}, app = {getVersion: () => '0.9.11'};
  let clock = 1_000, online = false, posts = 0;
  const fetcher = async (url, init) => {
    if (init?.method === 'POST') { posts++; if (!online) throw new Error('offline'); return new Response('{}'); }
    return Response.json({ok: true, replies: [reply()]});   // the site still holds it until a post lands
  };
  registerReplies({DEMO: false, app, ipcMain, storage: store(), fetcher, now: () => clock});
  assert.equal((await handlers.feedbackReplies()).length, 1);
  assert.equal(await handlers.feedbackReplyClose({}, 'a1b2c3d4e5f60718'), false, 'the post failed');
  clock += 6 * 3600 * 1000;
  assert.deepEqual(await handlers.feedbackReplies(), [], 'the site still sends it, the app does not show it again');
  online = true; clock += 6 * 3600 * 1000;
  assert.deepEqual(await handlers.feedbackReplies(), []);
  assert.ok(posts >= 3, 'the post was retried at each ask until it landed');
  clock += 6 * 3600 * 1000; const before = posts;
  await handlers.feedbackReplies();
  assert.equal(posts, before, 'once the site took it the app stops posting');
});

test('a close that could not be posted survives an app restart: the card stays hidden and the post goes out at the first ask after it', async () => {
  const st = store(), ipc = () => { const handlers = {}; return {handlers, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}}; }, app = {getVersion: () => '0.9.11'};
  let online = false; const posted = [];
  const fetcher = async (url, init) => {
    if (init?.method === 'POST') { if (!online) throw new Error('offline'); posted.push(JSON.parse(init.body).ref); return new Response('{}'); }
    return Response.json({ok: true, replies: [reply()]});
  };
  const first = ipc(); registerReplies({DEMO: false, app, ipcMain: first.ipcMain, storage: st, fetcher, now: () => 1_000});
  await first.handlers.feedbackReplies();
  assert.equal(await first.handlers.feedbackReplyClose({}, 'a1b2c3d4e5f60718'), false);
  online = true;   // restart: a new handler set, the same settings file
  const second = ipc(); registerReplies({DEMO: false, app, ipcMain: second.ipcMain, storage: st, fetcher, now: () => 5_000});
  assert.deepEqual(await second.handlers.feedbackReplies(), [], 'the closed card is not drawn again after the restart');
  assert.deepEqual(posted, ['a1b2c3d4e5f60718'], 'and the close is told to the website now');
  assert.deepEqual(st.settings().feedbackRepliesClosed, [], 'once the website took it nothing is kept');
});
