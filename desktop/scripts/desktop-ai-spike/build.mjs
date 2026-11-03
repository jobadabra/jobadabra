// Builds the spike's jobadabra-spike.mcpb (a zip: manifest.json + server/index.cjs) with the same jszip the app already ships; usage: node build.mjs [--out <folder>].
// manifest.json follows the MCPB spec (github.com/modelcontextprotocol/mcpb MANIFEST.md): required fields, server.type node, a tools list, compatibility.platforms.
// Why (3 Nov 2026): PR 1/6 of docs/superpowers/plans/2026-11-03-desktop-ai-mcp.md measures the unknowns before the real bridge is built.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The spike's manifest object (manifest.json beside this file is the one source; the Windows script packs the same file). */
export const manifest = () => JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));

/** Packs the bundle and returns its path. */
export async function build(out = path.join(os.tmpdir(), 'jobadabra-spike')) {
  fs.mkdirSync(out, {recursive: true});
  const zip = new JSZip();
  zip.file('manifest.json', fs.readFileSync(path.join(here, 'manifest.json')));
  zip.file('server/index.cjs', fs.readFileSync(path.join(here, 'server', 'index.cjs')));
  const file = path.join(out, 'jobadabra-spike.mcpb');
  fs.writeFileSync(file, await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
  return file;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--out');
  console.log(await build(at > 0 ? process.argv[at + 1] : undefined));
}
