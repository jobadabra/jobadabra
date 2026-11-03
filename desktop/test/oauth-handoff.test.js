// Every sign-in / connect hand-off (lib/oauth-handoff.js + lib/oauth-handoff-route.js): the app's own socket takes a result only for the state it made and is waiting on, once, shows no
// secret in the page and rewrites the tab's address. The class (Gitar on web#336, 3 Nov 2026): a link made by someone else makes a victim's browser deliver the victim's result to the
// victim's own app, where it must be dropped. Real requests to a real local server, one loop over every flow.
import assert from 'node:assert/strict';
import http from 'node:http';
import {test} from 'node:test';
import {FLOWS, begin, cancel, receive} from '../lib/oauth-handoff.js';
import {isOauthHandoff} from '../lib/oauth-handoff-route.js';
import {routeTable} from '../lib/server-routes.js';

const SECRET = 'FAKE-secret-value-1234567890';
function serve(flow) {
  const route = routeTable(async () => {}, async () => {}).find(([matches]) => typeof matches === 'function' && matches(`/${flow}/callback?x=1`));
  assert.ok(route, `the table has the ${flow} callback`);
  return new Promise(resolve => { const server = http.createServer((req, res) => route[1](req, res)); server.listen(0, '127.0.0.1', () => resolve(server)); });
}
const get = (server, flow, query, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({host: '127.0.0.1', port: server.address().port, path: `/${flow}/callback?${query}`, method}, res => {
    let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
  });
  req.on('error', reject); req.end();
});

for (const flow of FLOWS) {
  test(`${flow}: the awaited state is taken once and the page shows no secret; any other state, nothing awaited, or another flow's wait is dropped`, async t => {
    const server = await serve(flow);
    t.after(() => { cancel(flow); server.close(); });
    const stranger = await get(server, flow, `state=${'z'.repeat(43)}&access_token=${SECRET}`);
    assert.equal(stranger.status, 400, 'nothing waits: a link someone else made lands here on the victim\'s browser and is dropped');
    const {state, result} = begin(flow);
    const wrong = await get(server, flow, `state=${'y'.repeat(43)}&access_token=${SECRET}`);
    assert.equal(wrong.status, 400, 'waiting, but for another state');
    assert.doesNotMatch(wrong.body, /FAKE-secret/);
    const other = FLOWS.find(f => f !== flow), elsewhere = await serve(other);
    t.after(() => elsewhere.close());
    assert.equal((await get(elsewhere, other, `state=${state}&access_token=${SECRET}`)).status, 400, 'the right state on another flow\'s route is not taken');
    const ok = await get(server, flow, `state=${state}&access_token=${SECRET}&workspace_name=Space`);
    assert.equal(ok.status, 200);
    assert.match(ok.body, /Connected to/);
    assert.ok(!ok.body.includes(SECRET), 'the secret is not echoed');
    assert.ok(ok.body.includes(`history.replaceState(null,'','/${flow}/done')`), 'the tab\'s address loses the secret');
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.equal(ok.headers['referrer-policy'], 'no-referrer');
    assert.deepEqual(await result, {ok: true, fields: {access_token: SECRET, workspace_name: 'Space'}});
    assert.equal((await get(server, flow, `state=${state}&access_token=${SECRET}`)).status, 400, 'used once');
    const again = begin(flow);
    assert.equal((await get(server, flow, `state=${again.state}&access_token=${SECRET}`, 'POST')).status, 400, 'GET only');
    cancel(flow);
    assert.equal((await again.result).error, 'Cancelled.');
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
  assert.equal(isOauthHandoff('/other/callback?state=x'), false);
  assert.equal(isOauthHandoff('/notion-connect/callback?state=x'), true);
});
