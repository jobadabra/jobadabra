// The helper Claude Desktop starts (lib/desktop-ai-bridge/index.cjs) and the .mcpb built around it (lib/desktop-ai-mcpb.js). The secret store is a stand-in or a command recorder: no test touches a Keychain,
// PowerShell, port 47111 or Claude Desktop. The round trip at the end runs the helper against the real handler on a free port.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';
import JSZip from 'jszip';
import {buildHelper, manifestFor} from '../lib/desktop-ai-mcpb.js';
import {handleDesktopAi, setDesktopAiSources} from '../lib/desktop-ai-server.js';
import {disconnect} from '../lib/desktop-ai-pairing.js';
import {TOOLS, TOOL_NAMES} from '../lib/desktop-ai-tools.js';
import {fakeStorage} from './desktop-ai-fake-storage.js';

const {createBridge, secretStore, serve, post, CLOSED, GONE, ITEM} = createRequire(import.meta.url)('../lib/desktop-ai-bridge/index.cjs');
const tools = TOOLS.map(({name, description, inputSchema}) => ({name, description, inputSchema}));
const memoryStore = (kept = '') => { const state = {kept, sets: 0, clears: 0}; return {state, get: async () => state.kept, set: async token => { state.kept = token; state.sets++; return true; }, clear: async () => { state.kept = ''; state.clears++; }}; };
const callMessage = {jsonrpc: '2.0', id: 7, method: 'tools/call', params: {name: 'get_jobs', arguments: {}}};

test('initialize, ping and tools/list are answered by the helper itself, so Claude lists the tools while the app is closed', async () => {
  const handle = createBridge({config: {port: 1, code: 'c'}, tools, version: '9.9', send: async () => { throw new Error('must not call the app'); }, store: memoryStore()});
  assert.equal((await handle({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18'}})).result.serverInfo.version, '9.9');
  assert.deepEqual((await handle({jsonrpc: '2.0', id: 2, method: 'tools/list'})).result.tools.map(tool => tool.name), TOOL_NAMES);
  assert.deepEqual((await handle({jsonrpc: '2.0', id: 3, method: 'ping'})).result, {});
  assert.equal(await handle({jsonrpc: '2.0', method: 'notifications/initialized'}), null);
  assert.equal((await handle({jsonrpc: '2.0', id: 4, method: 'resources/list'})).error.code, -32601);
});

test('the first tool call swaps the code for a token, keeps it in the store, and forwards with it', async () => {
  const sent = [];
  const send = async (port, route, payload, token) => {
    sent.push({port, route, token});
    return route.endsWith('/pair') ? {status: 200, body: {token: 'tok-1'}} : {status: 200, body: {jsonrpc: '2.0', id: payload.id, result: {content: [{type: 'text', text: 'ok'}], isError: false}}};
  };
  const store = memoryStore();
  const handle = createBridge({config: {port: 4242, code: 'code-1'}, tools, send, store});
  assert.equal((await handle(callMessage)).result.content[0].text, 'ok');
  assert.equal(store.state.kept, 'tok-1');
  await handle(callMessage);
  assert.deepEqual(sent.map(each => `${each.route.split('/').pop()}:${each.token || '-'}`), ['pair:-', 'mcp:tok-1', 'mcp:tok-1'], 'paired once, then only the token');
  assert.ok(sent.every(each => each.port === 4242));
});

test('the app closed is one plain sentence, for the pairing call and for a tool call, and nothing is stored', async () => {
  const store = memoryStore();
  const closed = createBridge({config: {port: 1, code: 'c'}, tools, send: async () => ({closed: true}), store});
  assert.equal((await closed(callMessage)).result.content[0].text, CLOSED);
  const kept = memoryStore('tok');
  const closedLater = createBridge({config: {port: 1, code: 'c'}, tools, send: async () => ({closed: true}), store: kept});
  const answer = (await closedLater(callMessage)).result;
  assert.equal(answer.content[0].text, CLOSED);
  assert.equal(answer.isError, true);
  assert.equal(store.state.sets + kept.state.clears, 0);
});

test('a 401 (Disconnect) clears the stored token and says to press Connect again; a 426 says the same; a dead code does too', async () => {
  const store = memoryStore('tok');
  const handle = createBridge({config: {port: 1, code: 'c'}, tools, send: async () => ({status: 401, body: {error: 'disconnected'}}), store});
  assert.equal((await handle(callMessage)).result.content[0].text, GONE);
  assert.equal(store.state.kept, '');
  assert.equal(store.state.clears, 1);
  const outdated = createBridge({config: {port: 1, code: 'c'}, tools, send: async () => ({status: 426, body: {}}), store: memoryStore('tok')});
  assert.equal((await outdated(callMessage)).result.content[0].text, GONE);
  const deadCode = createBridge({config: {port: 1, code: 'old'}, tools, send: async () => ({status: 401, body: {}}), store: memoryStore()});
  assert.equal((await deadCode(callMessage)).result.content[0].text, GONE);
});

test('when the OS cannot keep the token, the helper keeps it nowhere else and says so', async () => {
  const noStore = {get: async () => '', set: async () => false, clear: async () => {}};
  const handle = createBridge({config: {port: 1, code: 'c'}, tools, send: async () => ({status: 200, body: {token: 'tok'}}), store: noStore});
  const answer = (await handle(callMessage)).result;
  assert.equal(answer.isError, true);
  assert.match(answer.content[0].text, /no safe place/);
});

test('Mac store: the Keychain item through /usr/bin/security with the exact commands; Windows: DPAPI through PowerShell with the token on stdin, never in an argument', async () => {
  const calls = [];
  const mac = secretStore({platform: 'darwin', exec: async (command, args, input) => { calls.push({command, args, input}); return {ok: true, out: 'the-token'}; }});
  assert.equal(await mac.get(), 'the-token');
  assert.equal(await mac.set('new-token'), true);
  await mac.clear();
  assert.deepEqual(calls.map(call => [call.command, call.args[0]]), [['/usr/bin/security', 'find-generic-password'], ['/usr/bin/security', 'add-generic-password'], ['/usr/bin/security', 'delete-generic-password']]);
  assert.ok(calls.every(call => call.args.includes(ITEM)));
  assert.equal(ITEM, 'jobadabra.desktop-ai-bridge');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-win-'));
  const winCalls = [];
  const blob = 'x'.repeat(60);
  const win = secretStore({platform: 'win32', dir, exec: async (command, args, input) => { winCalls.push({command, args, input}); return {ok: true, out: input === 'the-token' ? blob : 'the-token'}; }});
  assert.equal(await win.get(), '', 'no blob yet');
  assert.equal(await win.set('the-token'), true);
  assert.equal(fs.readFileSync(path.join(dir, 'token.dpapi'), 'utf8'), blob, 'only the protected blob is on disk');
  assert.equal(await win.get(), 'the-token');
  await win.clear();
  assert.ok(!fs.existsSync(path.join(dir, 'token.dpapi')));
  assert.ok(winCalls.every(call => call.command === 'powershell.exe' && !call.args.join(' ').includes('the-token')), 'the token is never an argument');
  assert.ok(winCalls.some(call => call.input === 'the-token'), 'it goes in on stdin');
  assert.equal(await secretStore({platform: 'linux'}).set('t'), false, 'no store, no keeping');
});

test('serve() reads one JSON-RPC message per line and answers one per line', async () => {
  const input = new PassThrough(), output = new PassThrough();
  serve(createBridge({config: {port: 1, code: 'c'}, tools, version: '1', send: async () => ({closed: true}), store: memoryStore()}), input, output);
  const lines = [];
  output.on('data', chunk => lines.push(...chunk.toString().trim().split('\n')));
  input.write(`${JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})}\nnot json\n${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`);
  for (let i = 0; i < 100 && !lines.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]).result.tools.map(tool => tool.name), TOOL_NAMES);
});

test('the built .mcpb holds exactly the manifest, tools, config and helper; the manifest lists the one tool list and the code is in config only', async () => {
  const storage = fakeStorage();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-test-'));
  const {file, code} = await buildHelper(storage, {version: '1.2.3', port: 50123, dir});
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  assert.deepEqual(Object.keys(zip.files).filter(name => !name.endsWith('/')).sort(), ['config.json', 'manifest.json', 'server/index.cjs', 'tools.json']);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.deepEqual(manifest, manifestFor({version: '1.2.3'}));
  assert.deepEqual(manifest.tools.map(tool => tool.name), TOOL_NAMES);
  for (const field of ['manifest_version', 'name', 'version', 'description', 'author', 'server']) assert.ok(manifest[field], field);
  assert.equal(manifest.server.type, 'node');
  assert.deepEqual(manifest.compatibility.platforms, ['darwin', 'win32']);
  const config = JSON.parse(await zip.file('config.json').async('string'));
  assert.equal(config.port, 50123);
  assert.equal(config.code, code);
  assert.equal(await zip.file('server/index.cjs').async('string'), fs.readFileSync(new URL('../lib/desktop-ai-bridge/index.cjs', import.meta.url), 'utf8'));
  for (const name of ['manifest.json', 'tools.json', 'server/index.cjs']) assert.ok(!(await zip.file(name).async('string')).includes(code), `${name} must not hold the code`);
  assert.ok(!JSON.stringify(storage.secrets).includes(code), 'the app keeps only the code\'s hash');
  assert.match(manifest.description, /never submits/);
});

test('round trip: the helper pairs with the real handler, reads a tool, and after Disconnect says to press Connect again and forgets its token', async () => {
  const storage = fakeStorage();
  setDesktopAiSources({jobs: async () => ({jobs: [{title: 'Nurse'}]})});
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => handleDesktopAi(req, res, Buffer.concat(chunks), {storage, PORT: server.address().port})); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const {code} = (await buildHelper(storage, {version: '1', port: server.address().port, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'helper-rt-'))}));
    const store = memoryStore();
    const handle = createBridge({config: {port: server.address().port, code}, tools, send: post, store});
    const first = await handle(callMessage);
    assert.ok(first.result.content[0].text.includes('Nurse'), first.result.content[0].text);
    assert.match(store.state.kept, /^[0-9a-f]{48}$/);
    const rePaired = createBridge({config: {port: server.address().port, code}, tools, send: post, store: memoryStore()});
    assert.equal((await rePaired(callMessage)).result.content[0].text, GONE, 'the one-time code does not work a second time');
    disconnect(storage);
    assert.equal((await handle(callMessage)).result.content[0].text, GONE);
    assert.equal(store.state.kept, '', 'the helper forgot the dead token');
  } finally { setDesktopAiSources(null); server.close(); }
});

test('the real post() to a port nothing listens on reports closed, not a crash', async () => {
  const free = await new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
  assert.deepEqual(await post(free, '/desktop-ai/v1/mcp', {}, 't', 2000), {closed: true});
});
