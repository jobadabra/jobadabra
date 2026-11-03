// The spike's stdio MCP server (CommonJS, no dependencies): one `ping` tool that reports what a bridge started by Claude Desktop can do on this computer.
// Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md ("Risks and unknowns"). It touches nothing of Jobadabra: no app data, no port 47111, only a throwaway secret and a refused loopback call.
// Invariants: never prints the throwaway secret; every probe catches its own error and reports it, so one blocked probe cannot hide the others.
'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');

const run = (command, args, input) => new Promise(resolve => {
  const child = execFile(command, args, {timeout: 15000, windowsHide: true}, (error, stdout, stderr) => resolve({ok: !error, stdout: String(stdout || '').trim(), error: error ? `${error.code || error.signal || 'error'}: ${String(stderr || error.message).trim().slice(0, 160)}` : ''}));
  if (input !== undefined) child.stdin.end(input);
});

const ITEM = 'jobadabra.desktop-ai-spike';   // a throwaway Keychain item name; deleted at the end of the probe

// macOS: add, read back and delete a generic password with the system `security` tool (no native module).
async function macStore(secret) {
  const steps = {};
  steps.add = (await run('/usr/bin/security', ['add-generic-password', '-U', '-a', 'spike', '-s', ITEM, '-w', secret])).ok;
  const found = await run('/usr/bin/security', ['find-generic-password', '-a', 'spike', '-s', ITEM, '-w']);
  steps.readBack = found.ok && found.stdout === secret;
  const removed = await run('/usr/bin/security', ['delete-generic-password', '-a', 'spike', '-s', ITEM]);
  steps.delete = removed.ok;
  return {store: 'macOS Keychain via /usr/bin/security', ok: steps.add && steps.readBack && steps.delete, steps, error: [found.error, removed.error].filter(Boolean).join(' | ')};
}

// Windows: protect the secret with DPAPI (current user) through PowerShell, keep the blob in a per-user folder, read it back, delete it.
async function winStore(secret) {
  const folder = path.join(os.homedir(), '.jobadabra-spike'), file = path.join(folder, 'blob.txt');
  const steps = {};
  fs.mkdirSync(folder, {recursive: true});
  const protect = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString"], secret);
  steps.protect = protect.ok && protect.stdout.length > 40;
  if (steps.protect) fs.writeFileSync(file, protect.stdout);
  const blob = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  const reveal = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$s = [Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"], blob);
  steps.readBack = reveal.ok && reveal.stdout === secret;
  steps.blobHidesSecret = !!blob && !blob.includes(secret);
  try { fs.rmSync(folder, {recursive: true, force: true}); steps.delete = !fs.existsSync(folder); } catch { steps.delete = false; }
  return {store: 'Windows DPAPI via PowerShell', ok: steps.protect && steps.readBack && steps.blobHidesSecret && steps.delete, steps, error: [protect.error, reveal.error].filter(Boolean).join(' | ')};
}

async function secretStore() {
  if (process.env.SPIKE_SECRET_STORE === 'off') return {store: 'skipped', ok: null, steps: {}, error: ''};
  const secret = `spike-${crypto.randomBytes(12).toString('hex')}`;
  try {
    if (process.platform === 'darwin') return await macStore(secret);
    if (process.platform === 'win32') return await winStore(secret);
    return {store: 'none for this platform', ok: false, steps: {}, error: process.platform};
  } catch (error) { return {store: 'threw', ok: false, steps: {}, error: String(error.message).slice(0, 160)}; }
}

// A loopback call to a port nothing listens on: ECONNREFUSED means the call left the bridge and reached the loopback (allowed); anything else is a block.
const loopback = () => new Promise(resolve => {
  const req = http.get({host: '127.0.0.1', port: 47199, path: '/ping', timeout: 3000}, res => { res.resume(); resolve({reached: true, status: res.statusCode}); });
  req.on('timeout', () => { req.destroy(); resolve({reached: false, error: 'timeout'}); });
  req.on('error', error => resolve({reached: error.code === 'ECONNREFUSED', error: error.code || error.message}));
});

async function ping() {
  const folder = path.join(os.homedir(), '.jobadabra-spike-write');
  let writable = false;
  try { fs.mkdirSync(folder, {recursive: true}); fs.writeFileSync(path.join(folder, 'x'), '1'); writable = true; fs.rmSync(folder, {recursive: true, force: true}); } catch { /* reported as false */ }
  return {
    at: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.version, execPath: path.basename(process.execPath),
    homeWritable: writable, secretStore: await secretStore(), loopback: await loopback(),
  };
}

const TOOLS = [{name: 'ping', description: 'Reports what the Jobadabra spike bridge can do on this computer (secret store, loopback, folder). Changes nothing.', inputSchema: {type: 'object', properties: {}}}];

/** One JSON-RPC message in, the reply out (null for a notification). */
async function handle(message) {
  const {id, method, params} = message;
  if (id === undefined) return null;   // notifications/initialized and others: no reply
  const reply = result => ({jsonrpc: '2.0', id, result});
  if (method === 'initialize') return reply({protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'jobadabra-spike', version: '0.0.1'}});
  if (method === 'tools/list') return reply({tools: TOOLS});
  if (method === 'tools/call' && params?.name === 'ping') return reply({content: [{type: 'text', text: JSON.stringify(await ping(), null, 1)}]});
  if (method === 'ping') return reply({});
  return {jsonrpc: '2.0', id, error: {code: -32601, message: `unknown method ${method}`}};
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    handle(message).then(out => { if (out) process.stdout.write(`${JSON.stringify(out)}\n`); });
  }
});
