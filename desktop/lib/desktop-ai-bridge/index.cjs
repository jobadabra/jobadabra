// The helper Claude Desktop starts from the .mcpb file: a stdio MCP server that forwards each tool call to the Jobadabra app on this computer (127.0.0.1) and keeps its token in the OS secret store.
// Packed by lib/desktop-ai-mcpb.js; CommonJS with no dependencies because it runs under Claude Desktop's own Node. Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md.
// Invariants: the token is stored only in the Keychain (/usr/bin/security) or as a DPAPI blob (current Windows user), never in a plain file, never printed or logged; the app closed means a plain
// sentence ("Open Jobadabra and ask again"), never a start of the app; nothing is sent anywhere but 127.0.0.1; initialize and tools/list come from the manifest so Claude lists the tools while the app is closed.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {execFile} = require('node:child_process');

const BRIDGE_VERSION = '1';
const ITEM = 'jobadabra.desktop-ai-bridge';
const CLOSED = 'Jobadabra is not open. Open the Jobadabra app and ask again.';
const GONE = 'The connection to Jobadabra was removed or is out of date. Press Connect in Jobadabra again.';

const run = (command, args, input) => new Promise(resolve => {
  const child = execFile(command, args, {timeout: 15000, windowsHide: true}, (error, stdout) => resolve({ok: !error, out: String(stdout || '').trim()}));
  if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }   // Why (code review 3 Nov 2026): a killed child must not crash the helper with an unhandled EPIPE
});

/** The OS secret store for this platform: {get, set, clear} (all async). `exec` and `dir` are seams for tests. Windows keeps a DPAPI blob (only this Windows user can open it) in the bridge's own folder. */
function secretStore({platform = process.platform, exec = run, dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), ITEM)} = {}) {
  if (platform === 'darwin') {
    return {
      get: async () => { const done = await exec('/usr/bin/security', ['find-generic-password', '-a', 'bridge', '-s', ITEM, '-w']); return done.ok ? done.out : ''; },
      // Why: `security -w` takes the value as an argument, visible to this user's own processes for a moment; they can read this Keychain item anyway, and no other user can see it.
      set: async token => (await exec('/usr/bin/security', ['add-generic-password', '-U', '-a', 'bridge', '-s', ITEM, '-w', token])).ok,
      clear: async () => { await exec('/usr/bin/security', ['delete-generic-password', '-a', 'bridge', '-s', ITEM]); },
    };
  }
  if (platform === 'win32') {
    const file = path.join(dir, 'token.dpapi');
    const ps = (script, input) => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], input);
    return {
      get: async () => {
        let blob = '';
        try { blob = fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
        const done = await ps('$s = [Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))', blob);
        return done.ok ? done.out : '';
      },
      set: async token => {
        const done = await ps('[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString', token);   // the token goes in on stdin, never as an argument
        if (!done.ok || done.out.length < 40) return false;
        try { fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(file, done.out); } catch { return false; }   // a full disk or a denied folder is "no safe place", not a crash
        return true;
      },
      clear: async () => { try { fs.rmSync(file, {force: true}); } catch { /* nothing to remove */ } },
    };
  }
  return {get: async () => '', set: async () => false, clear: async () => {}};
}

/** One POST to the app. -> {status, body} or {closed: true} when nothing listens (the app is not running). */
function post(port, route, payload, token, timeout = 20000) {
  return new Promise(resolve => {
    const data = JSON.stringify(payload);
    const req = http.request({host: '127.0.0.1', port, path: route, method: 'POST', timeout, headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'x-desktop-ai-bridge': BRIDGE_VERSION, ...(token ? {Authorization: `Bearer ${token}`} : {})}}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString() || 'null'); } catch { /* an empty or non-JSON body */ } resolve({status: res.statusCode, body}); });
    });
    req.on('timeout', () => { req.destroy(); resolve({closed: true}); });
    req.on('error', () => resolve({closed: true}));
    req.end(data);
  });
}

const UNSAFE = 'This computer has no safe place to keep the connection. Nothing was saved.';
const FAILED = 'Jobadabra did not answer that. Try again.';
const text = (id, message, isError = true) => ({jsonrpc: '2.0', id, result: {content: [{type: 'text', text: message}], isError}});

/**
 * The helper's brain. `config` = {port, code, version} (config.json beside it), `tools` = tools.json (name, description, inputSchema: answers tools/list), `version` the app's, `store` the secret store, `send` the HTTP post.
 * -> handle(message) resolving to the reply object, or null for a notification.
 */
function createBridge({config, tools, version = '0', store = secretStore(), send = post}) {
  let pairing = null;   // Why (code review 3 Nov 2026): Claude fires tool calls in parallel; they share one pairing, because the code works once
  const pair = () => {
    pairing ||= (async () => {
      const again = await store.get();   // a call that started before the first pairing finished finds the token here
      if (again) return {token: again};
      if (!config.code) return {gone: true};
      const paired = await send(config.port, '/desktop-ai/v1/pair', {code: config.code});
      if (paired.closed) return {closed: true};
      if (paired.status !== 200 || !paired.body?.token) return {gone: true};
      if (!(await store.set(paired.body.token))) return {unsafe: true};   // no safe place to keep it: do not keep it anywhere else (spec: secrets only in the OS store)
      return {token: paired.body.token};
    })().finally(() => { pairing = null; });
    return pairing;
  };
  const token = async () => { const kept = await store.get(); return kept ? {token: kept} : pair(); };
  const refusal = (id, got) => (got.closed ? text(id, CLOSED) : got.gone ? text(id, GONE) : got.unsafe ? text(id, UNSAFE) : null);
  async function call(message) {
    const {id} = message;
    let got = await token();
    if (refusal(id, got)) return refusal(id, got);
    let done = await send(config.port, '/desktop-ai/v1/mcp', message, got.token);
    if (done.status === 401) {   // the stored token is dead (Disconnect): forget it, and pair again with this file's code when that is still good, so Connect then ask works at once
      await store.clear();
      got = config.code ? await pair() : {gone: true};
      if (refusal(id, got)) return refusal(id, got);
      done = await send(config.port, '/desktop-ai/v1/mcp', message, got.token);
      if (done.status === 401) { await store.clear(); return text(id, GONE); }
    }
    if (done.closed) return text(id, CLOSED);
    if (done.status === 426) return text(id, GONE);
    if (done.status !== 200 || !done.body) return text(id, FAILED);
    return done.body;
  }
  return async function handle(message) {
    const {id, method, params} = message || {};
    if (id === undefined) return null;
    if (method === 'initialize') return {jsonrpc: '2.0', id, result: {protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'jobadabra', version}}};
    if (method === 'ping') return {jsonrpc: '2.0', id, result: {}};
    if (method === 'tools/list') return {jsonrpc: '2.0', id, result: {tools: tools.map(tool => ({name: tool.name, description: tool.description, inputSchema: tool.inputSchema || {type: 'object', properties: {}}}))}};
    if (method !== 'tools/call') return {jsonrpc: '2.0', id, error: {code: -32601, message: `Unknown method ${method}`}};
    try { return await call(message); } catch { return text(id, FAILED); }   // a request with an id always gets an answer
  };
}

/** Reads stdin line by line and answers on stdout (one JSON-RPC message per line). */
function serve(handle, input = process.stdin, output = process.stdout) {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      handle(message).then(reply => { if (reply) output.write(`${JSON.stringify(reply)}\n`); }).catch(() => { if (message?.id !== undefined) output.write(`${JSON.stringify(text(message.id, FAILED))}\n`); });
    }
  });
}

module.exports = {createBridge, secretStore, serve, post, ITEM, CLOSED, GONE};

if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  const tools = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools.json'), 'utf8'));
  serve(createBridge({config, tools, version: config.version}));
}
