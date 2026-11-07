// Every sign-in / connect hand-off (lib/oauth-handoff.js + lib/oauth-handoff-route.js): the app's own socket takes a result (a POSTed form body, never an address, so it stays out of the browser
// history) only for the state it made and is waiting on, once, and shows no secret in the page. The class (Gitar on web#336, 3 Nov 2026): a link made by someone else makes a victim's browser
// deliver the victim's result to the victim's own app, where it must be dropped. Real requests to a real local server, one loop over every flow.
import assert from 'node:assert/strict';
import http from 'node:http';
import {test} from 'node:test';
import {FLOWS, begin, cancel, fail, receive} from '../../../lib/oauth-handoff.js';
import {isOauthHandoff} from '../../../lib/oauth-handoff-route.js';
import {routeTable} from '../../../lib/server-routes.js';

const SECRET = 'FAKE-secret-value-1234567890';
function serve(flow) {
  const route = routeTable(async () => {}, async () => {}).find(([matches]) => typeof matches === 'function' && matches(`/${flow}/callback`));
  assert.ok(route, `the table has the ${flow} callback`);
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => route[1](req, res, chunks.length ? Buffer.concat(chunks) : undefined));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const send = (server, flow, form, {method = 'POST', query = ''} = {}) => new Promise((resolve, reject) => {
  const body = new URLSearchParams(form).toString();
  const req = http.request({host: '127.0.0.1', port: server.address().port, path: `/${flow}/callback${query}`, method,
    headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body)}}, res => {
    let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: text}));
  });
  req.on('error', reject); req.end(body);
});

for (const flow of FLOWS) {
  test(`${flow}: the awaited state is taken once from a POST and the page shows no secret; any other state, nothing awaited, a GET or another flow's wait is dropped`, async t => {
    const server = await serve(flow);
    t.after(() => { cancel(flow); server.close(); });
    const stranger = await send(server, flow, {state: 'z'.repeat(43), access_token: SECRET});
    assert.equal(stranger.status, 400, 'nothing waits: a link someone else made lands here on the victim\'s browser and is dropped');
    const {state, result} = begin(flow);
    const wrong = await send(server, flow, {state: 'y'.repeat(43), access_token: SECRET});
    assert.equal(wrong.status, 400, 'waiting, but for another state');
    assert.doesNotMatch(wrong.body, /FAKE-secret/);
    assert.equal((await send(server, flow, {state: `${'a'.repeat(42)}é`, access_token: SECRET})).status, 400, 'a non-ASCII state with the right number of characters (more bytes) is dropped, not a crash');
    const other = FLOWS.find(f => f !== flow), elsewhere = await serve(other);
    t.after(() => elsewhere.close());
    assert.equal((await send(elsewhere, other, {state, access_token: SECRET})).status, 400, 'the right state on another flow\'s route is not taken');
    assert.equal((await send(server, flow, {}, {method: 'GET', query: `?state=${state}&access_token=${SECRET}`})).status, 400, 'a GET with the result in the address is never taken');
    const ok = await send(server, flow, {state, access_token: SECRET, workspace_name: 'Space'});
    assert.equal(ok.status, 200);
    assert.match(ok.body, /Connected ✓/);
    assert.ok(!ok.body.includes(SECRET), 'the secret is not echoed');
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.equal(ok.headers['referrer-policy'], 'no-referrer');
    assert.deepEqual(await result, {ok: true, fields: {access_token: SECRET, workspace_name: 'Space'}});
    assert.equal((await send(server, flow, {state, access_token: SECRET})).status, 400, 'used once');
    cancel(flow);
  });
}

test('a new wait cancels the old one, a too large hand-off is dropped, and only known flows are routed', async () => {
  const first = begin('notion-connect'), second = begin('notion-connect');
  assert.equal((await first.result).error, 'Cancelled.');
  assert.equal(receive('notion-connect', new URLSearchParams({state: first.state, access_token: SECRET})), false, 'the old state no longer opens');
  assert.equal(receive('notion-connect', new URLSearchParams({state: second.state, big: 'x'.repeat(5000)})), false);
  assert.equal(receive('notion-connect', new URLSearchParams({state: second.state, access_token: SECRET})), true);
  assert.deepEqual((await second.result).fields, {access_token: SECRET});
  assert.throws(() => begin('other'), /unknown hand-off flow/);
  assert.equal(isOauthHandoff('/other/callback'), false);
  assert.equal(isOauthHandoff('/notion-connect/callback'), true);
  assert.equal(isOauthHandoff('/notion-connect/callback?x=1'), true);
});

test('private failure observer sees canonical timeout/open identity for every flow, ignores returns and never sees cancellation or credentials', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  for (const flow of FLOWS) {
    const seen = [], observe = (...args) => {seen.push(args); return {ok: true, fields: {mustNotReplace: true}};};
    const timed = begin(flow, {timeout: 7, timeoutError: 'canonical timeout', onFailureResult: observe});
    t.mock.timers.tick(7);
    const timeoutAnswer = await timed.result;
    assert.deepEqual(timeoutAnswer, {ok: false, error: 'canonical timeout'});
    assert.equal(seen[0][0], timeoutAnswer); assert.deepEqual(seen[0].slice(1), ['timeout']);
    assert.deepEqual(Reflect.ownKeys(timeoutAnswer), ['ok', 'error']);
    const opened = begin(flow, {onFailureResult: observe}); fail(flow, 'canonical open failure');
    const openAnswer = await opened.result;
    assert.deepEqual(openAnswer, {ok: false, error: 'canonical open failure'});
    assert.equal(seen[1][0], openAnswer); assert.deepEqual(seen[1].slice(1), ['open']);
    const cancelled = begin(flow, {onFailureResult: observe}); cancel(flow);
    assert.deepEqual(await cancelled.result, {ok: false, error: 'Cancelled.'});
    const replaced = begin(flow, {onFailureResult: observe}), success = begin(flow, {onFailureResult: observe});
    assert.deepEqual(await replaced.result, {ok: false, error: 'Cancelled.'});
    assert.equal(receive(flow, new URLSearchParams({state: replaced.state, access_token: SECRET})), false);
    assert.equal(receive(flow, new URLSearchParams({state: success.state, access_token: SECRET})), true);
    assert.deepEqual(await success.result, {ok: true, fields: {access_token: SECRET}});
    assert.equal(receive(flow, new URLSearchParams({state: success.state, access_token: SECRET})), false);
    t.mock.timers.tick(5 * 60 * 1000);
    assert.equal(seen.length, 2, 'only authored failure results reach the observer');
    assert.ok(seen.every(([answer]) => JSON.stringify(answer).includes(SECRET) === false));
  }
});

test('a throwing private failure observer cannot stop timeout/open resolution or change default callers', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  for (const flow of FLOWS) {
    const seen = [], onFailureResult = (answer, reason) => {seen.push([answer, reason]); throw new Error('metadata failed');};
    const timed = begin(flow, {timeout: 1, onFailureResult}); t.mock.timers.tick(1);
    assert.deepEqual(await timed.result, {ok: false, error: 'The website didn\'t answer in 5 minutes. Try again.'});
    const opened = begin(flow, {onFailureResult}); fail(flow, 'canonical fallback');
    assert.deepEqual(await opened.result, {ok: false, error: 'canonical fallback'});
    assert.deepEqual(seen.map(([, reason]) => reason), ['timeout', 'open']);
    const plain = begin(flow, {timeout: 1}); t.mock.timers.tick(1);
    assert.deepEqual(await plain.result, {ok: false, error: 'The website didn\'t answer in 5 minutes. Try again.'});
    const plainOpen = begin(flow); fail(flow, 'unchanged');
    assert.deepEqual(await plainOpen.result, {ok: false, error: 'unchanged'});
  }
});
