// Builds the Jobadabra helper for Claude Desktop at the moment the person presses Connect: a .mcpb (zip) with a manifest generated from the one tool list, the helper (lib/desktop-ai-bridge/index.cjs),
// tools.json (the schemas the helper answers tools/list with) and config.json (this app's port, a fresh one-time code). Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md ("Transport and install").
// Invariants: the zip holds the one-time code in plain text on purpose (it is a 10-minute pairing step, never the token; lib/desktop-ai-pairing.js); the manifest lists exactly TOOLS, nothing else.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {TOOLS} from './desktop-ai-tools.js';
import {startPairing} from './desktop-ai-pairing.js';
import {BRIDGE_VERSION} from './desktop-ai-server.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The MCPB manifest (github.com/modelcontextprotocol/mcpb MANIFEST.md): required fields, node server, the tool names and descriptions Claude's install window lists. */
export function manifestFor({version, family = 'Claude'}) {
  return {
    manifest_version: '0.2', name: 'jobadabra', display_name: 'Jobadabra', version,
    description: `Lets ${family} read your Jobadabra questions, jobs and Profile and help answer them. It never submits an application and never sees your passwords or keys. Everything it changes is listed in Jobadabra.`,
    author: {name: 'Jobadabra'},
    server: {type: 'node', entry_point: 'server/index.cjs', mcp_config: {command: 'node', args: ['${__dirname}/server/index.cjs']}},
    tools: TOOLS.map(({name, description}) => ({name, description})),
    compatibility: {platforms: ['darwin', 'win32']},
  };
}

/** Packs the helper for this app. `version` is the app's; `port` the port this app listens on. -> {file, code, expires} (the file in `dir`, the code is already registered with `storage`). */
export async function buildHelper(storage, {version, port, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobadabra-helper-')), family = 'Claude', now = Date.now()}) {
  const {code, expires} = startPairing(storage, now);
  const zip = new JSZip();
  zip.file('manifest.json', `${JSON.stringify(manifestFor({version, family}), null, 2)}\n`);
  zip.file('tools.json', JSON.stringify(TOOLS.map(({name, description, inputSchema}) => ({name, description, inputSchema}))));
  zip.file('config.json', JSON.stringify({port, code, version: String(version), bridge: BRIDGE_VERSION}));
  zip.file('server/index.cjs', fs.readFileSync(path.join(here, 'desktop-ai-bridge', 'index.cjs')));
  const file = path.join(dir, 'jobadabra.mcpb');
  fs.writeFileSync(file, await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
  return {file, code, expires};
}
