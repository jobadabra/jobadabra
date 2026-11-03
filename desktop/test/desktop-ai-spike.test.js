// The desktop AI spike bundle (scripts/desktop-ai-spike): the packed file has a valid MCPB manifest and its stdio server answers initialize, tools/list and tools/call.
// The secret store probe is switched off here (SPIKE_SECRET_STORE=off): a test never touches the Keychain; the real probe is run by hand on a Mac and by the Windows script.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import JSZip from 'jszip';
import {build, manifest} from '../scripts/desktop-ai-spike/build.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spike-test-'));

test('the packed bundle holds the manifest and the server, and the manifest names the required MCPB fields', async () => {
  const file = await build(tmp());
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  assert.deepEqual(Object.keys(zip.files).filter(name => !name.endsWith('/')).sort(), ['manifest.json', 'server/index.cjs']);
  const m = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.deepEqual(m, manifest());
  for (const field of ['manifest_version', 'name', 'version', 'description', 'author', 'server']) assert.ok(m[field], field);
  assert.equal(m.server.type, 'node');
  assert.ok(m.server.mcp_config.args[0].includes('${__dirname}'));
  assert.deepEqual(m.compatibility.platforms, ['darwin', 'win32']);
  assert.deepEqual(m.tools.map(tool => tool.name), ['ping']);
});

test('the server lists exactly the ping tool and answers a call without touching a secret store', async () => {
  const file = await build(tmp());
  const dir = tmp();
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(dir, 'server', 'index.cjs'), await zip.file('server/index.cjs').async('string'));
  const child = spawn(process.execPath, [path.join(dir, 'server', 'index.cjs')], {env: {...process.env, SPIKE_SECRET_STORE: 'off'}});
  const replies = [];
  let rest = '';
  child.stdout.on('data', chunk => { rest += chunk; let at; while ((at = rest.indexOf('\n')) >= 0) { replies.push(JSON.parse(rest.slice(0, at))); rest = rest.slice(at + 1); } });
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const reply = async id => { for (let i = 0; i < 200 && !replies.find(r => r.id === id); i++) await new Promise(resolve => setTimeout(resolve, 25)); return replies.find(r => r.id === id); };
  try {
    send({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '0'}}});
    assert.equal((await reply(1)).result.protocolVersion, '2025-06-18');
    send({jsonrpc: '2.0', method: 'notifications/initialized'});
    send({jsonrpc: '2.0', id: 2, method: 'tools/list'});
    assert.deepEqual((await reply(2)).result.tools.map(tool => tool.name), ['ping']);
    send({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'ping', arguments: {}}});
    const result = JSON.parse((await reply(3)).result.content[0].text);
    assert.equal(result.platform, process.platform);
    assert.equal(result.secretStore.store, 'skipped');
    assert.equal(result.loopback.reached, true);   // nothing listens on 47199: ECONNREFUSED is the proof that the call left the bridge and hit the loopback
    send({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'delete_everything'}});
    assert.equal((await reply(4)).error.code, -32601);
  } finally { child.kill(); }
});
