// The app's side of the desktop AI helper (lib/desktop-ai-server.js) over a real HTTP socket on a free port (never 47111): who may call, what they get, and what stops a web page or an old token.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {handleDesktopAi, isDesktopAiRoute, setDesktopAiSources, BRIDGE_VERSION} from '../lib/desktop-ai-server.js';
import {startPairing, redeem, disconnect} from '../lib/desktop-ai-pairing.js';
import {TOOL_NAMES, UNTRUSTED} from '../lib/desktop-ai-tools.js';
import {fakeStorage} from './desktop-ai-fake-storage.js';

const storage = fakeStorage({EXTENSION_TOKEN: 'extension-token-never-accepted-here'});
let server, port;
before(async () => {
  setDesktopAiSources({questions: async () => ({questions: [{id: 'q1', question: 'Notice period?', value: ''}]}), jobs: async () => ({jobs: []})});
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => handleDesktopAi(req, res, chunks.length ? Buffer.concat(chunks) : undefined, {storage, PORT: port}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(() => { setDesktopAiSources(null); server.close(); });

const call = (route, {method = 'POST', headers = {}, body} = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const req = http.request({host: '127.0.0.1', port, path: route, method, headers: {'Content-Type': 'application/json', ...headers}}, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve({status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null}); });
  });
  req.on('error', reject);
  req.end(data);
});
const rpc = (token, message, headers = {}) => call('/desktop-ai/v1/mcp', {headers: {Authorization: `Bearer ${token}`, 'x-desktop-ai-bridge': BRIDGE_VERSION, ...headers}, body: {jsonrpc: '2.0', ...message}});
const pair = async () => (await call('/desktop-ai/v1/pair', {body: {code: startPairing(storage).code}})).body.token;

test('only /desktop-ai/v1/ paths are this handler\'s', () => {
  assert.ok(isDesktopAiRoute('/desktop-ai/v1/mcp'));
  assert.ok(!isDesktopAiRoute('/extension/me') && !isDesktopAiRoute('/desktop-ai/v2/mcp') && !isDesktopAiRoute(undefined));
});

test('pairing: a code gives a token and the tool names once; the same code, a wrong one and an expired one are refused', async () => {
  const {code} = startPairing(storage);
  const done = await call('/desktop-ai/v1/pair', {body: {code}});
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.tools, TOOL_NAMES);
  assert.equal((await call('/desktop-ai/v1/pair', {body: {code}})).status, 401, 'the same code twice');
  assert.equal((await call('/desktop-ai/v1/pair', {body: {code: 'nope'}})).status, 401);
  assert.equal((await call('/desktop-ai/v1/pair', {body: 'not json'})).status, 401);
  const old = startPairing(storage, Date.now() - 11 * 60 * 1000);
  assert.equal((await call('/desktop-ai/v1/pair', {body: {code: old.code}})).status, 401, 'over 10 minutes');
});

test('mcp: no token, a wrong token and the extension\'s token are all 401 "disconnected"', async () => {
  await pair();
  for (const token of ['', 'wrong', 'extension-token-never-accepted-here']) {
    const done = await rpc(token, {id: 1, method: 'tools/list'});
    assert.equal(done.status, 401, `token "${token}"`);
    assert.equal(done.body.error, 'disconnected');
  }
  assert.equal((await call('/desktop-ai/v1/mcp', {headers: {'x-desktop-ai-bridge': BRIDGE_VERSION}, body: {jsonrpc: '2.0', id: 1, method: 'tools/list'}})).status, 401, 'no Authorization header');
});

test('a web page cannot call it: any Origin and any Host but 127.0.0.1 are 403, even with a valid token', async () => {
  const token = await pair();
  const message = {id: 1, method: 'tools/list'};
  assert.equal((await rpc(token, message, {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await rpc(token, message, {Origin: 'null'})).status, 403);
  assert.equal((await rpc(token, message, {Host: `localhost:${port}`})).status, 403, 'a rebinding name');
  assert.equal((await rpc(token, message, {Host: `evil.example:${port}`})).status, 403);
  assert.equal((await call('/desktop-ai/v1/pair', {headers: {Origin: 'https://evil.example'}, body: {code: startPairing(storage).code}})).status, 403, 'pairing too');
  assert.equal((await rpc(token, message)).status, 200, 'the same call from the helper is fine');
});

test('no response ever carries a CORS header, and GET is refused', async () => {
  const token = await pair();
  const done = await rpc(token, {id: 1, method: 'ping'});
  assert.ok(!Object.keys(done.headers).some(name => name.startsWith('access-control-')));
  assert.equal((await call('/desktop-ai/v1/mcp', {method: 'GET'})).status, 405);
  assert.equal((await call('/desktop-ai/v1/other', {body: {}})).status, 404);
});

test('an old helper (no or other bridge version) gets 426, not a guess', async () => {
  const token = await pair();
  assert.equal((await rpc(token, {id: 1, method: 'tools/list'}, {'x-desktop-ai-bridge': '0'})).status, 426);
});

test('tools/list is exactly the fixed list; tools/call runs a read tool and marks its text untrusted; an unknown tool or method is a JSON-RPC error', async () => {
  const token = await pair();
  const list = await rpc(token, {id: 1, method: 'tools/list'});
  assert.deepEqual(list.body.result.tools.map(tool => tool.name), TOOL_NAMES);
  const asked = await rpc(token, {id: 2, method: 'tools/call', params: {name: 'get_open_questions', arguments: {}}});
  assert.equal(asked.body.result.isError, false);
  assert.ok(asked.body.result.content[0].text.includes('Notice period?'));
  assert.ok(asked.body.result.content[0].text.includes(UNTRUSTED));
  assert.equal((await rpc(token, {id: 3, method: 'tools/call', params: {name: 'submit_application', arguments: {}}})).body.error.code, -32602);
  assert.equal((await rpc(token, {id: 4, method: 'resources/list'})).body.error.code, -32601);
  assert.equal((await rpc(token, {method: 'notifications/initialized'})).status, 202, 'a notification has no reply');
});

test('with no sources (demo mode) every tool says it is not available instead of failing', async () => {
  const token = await pair();
  setDesktopAiSources(null);
  try {
    const done = await rpc(token, {id: 1, method: 'tools/call', params: {name: 'get_jobs', arguments: {}}});
    assert.match(done.body.result.content[0].text, /not available right now/);
  } finally { setDesktopAiSources({questions: async () => ({}), jobs: async () => ({})}); }
});

test('after Disconnect the same token and the same code both fail; connecting again gives a different token', async () => {
  const code = startPairing(storage).code;
  const first = (await call('/desktop-ai/v1/pair', {body: {code}})).body.token;
  assert.equal((await rpc(first, {id: 1, method: 'ping'})).status, 200);
  const spare = startPairing(storage).code;
  disconnect(storage);
  assert.equal((await rpc(first, {id: 2, method: 'ping'})).status, 401);
  assert.equal((await call('/desktop-ai/v1/pair', {body: {code: spare}})).status, 401);
  assert.equal((await call('/desktop-ai/v1/pair', {body: {code}})).status, 401);
  const second = (await call('/desktop-ai/v1/pair', {body: {code: startPairing(storage).code}})).body.token;
  assert.notEqual(second, first);
  assert.equal((await rpc(first, {id: 3, method: 'ping'})).status, 401, 'the old token never comes back');
  assert.equal((await rpc(second, {id: 4, method: 'ping'})).status, 200);
});

test('redeem is the only way in: the code the test used is not accepted as a bearer token', async () => {
  const code = startPairing(storage).code;
  assert.equal((await rpc(code, {id: 1, method: 'ping'})).status, 401);
  assert.ok(redeem(storage, code), 'and it still pairs');
});
