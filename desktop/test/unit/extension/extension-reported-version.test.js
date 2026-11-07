// The owner's 0.9.13 retest (7 Nov 2026): the extension ran 0.9.756 code but checked in as 0.9.759 (its `reloadedFor` posed as its version), so the app saw "current" and never said "reload the extension".
// The app counts the extension at its manifest version; only a development copy counts as the version it reloaded for. The real server; native browser operations cut off as extension-store-id.test.js does.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {createStorage} from '../../../lib/storage.js';
import {reportedVersion} from '../../../lib/extension-version.js';

registerHooks({load(url, context, next) {
  if (url === new URL('../../../lib/extension-ready.js', import.meta.url).href) return {format: 'module', shortCircuit: true, source: 'export const extensionReady = async () => ({waited: 0});'};
  if (url === new URL('../../../lib/form-tab.js', import.meta.url).href) return {format: 'module', shortCircuit: true, source: `
    export const ATS = /jobs\\.test/;
    export const openFormTab = async () => 'tab'; export const listTabs = async () => [];
    export const reloadFormTab = async () => 'no-tab';
    export const closeFormTab = () => { throw Error('no real browser'); };
    export const focusTabAt = closeFormTab; export const focusTabById = closeFormTab;
  `};
  return next(url, context);
}});

const freePort = () => new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });
// Why (7 Nov 2026): the port goes in the env BEFORE lib/server.js (or anything importing it) is first loaded, which reads it once; a late env sent this test's check-ins to the owner's real app on 47111.
process.env.JOBADABRA_PORT = String(await freePort());

test('a packaged copy whose reload did not take is counted at the version it runs, so the app names it old', async () => {
  const {staleExtension} = await import('../../../lib/server-env.js');
  const owner = {version: '0.9.756', reloadedFor: '0.9.759'};   // the owner's check-in: old code, a reload that changed nothing
  assert.equal(reportedVersion(owner, false), '0.9.756');
  assert.match(staleExtension(reportedVersion(owner, false), '0.9.759'), /older than this app's 0\.9\.759/, 'the stale wording the toasts and fill reports use');
  assert.equal(reportedVersion(owner, true), '0.9.759', 'a development copy keeps its base manifest and counts as the stamped version it reloaded for');
  assert.equal(reportedVersion({version: '0.9.756'}, true), '0.9.756', 'never reloaded: the manifest');
  assert.equal(reportedVersion({version: '0.9.760', reloadedFor: '0.9.759'}, true), '0.9.760', 'a manifest ahead of the reload stands');
});

test('the server counts a check-in at the reported version rule and logs which copy checked in', async () => {
  const server = await import('../../../lib/server.js');
  assert.equal(String(server.PORT), process.env.JOBADABRA_PORT, 'this test talks to its own server, never the app on 47111');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reported-version-')), {encrypt: s => s, decrypt: s => s});
  const running = server.start(storage, error => assert.fail(error));
  await new Promise(resolve => setTimeout(resolve, 100));
  const FOLDER = 'gpffoneapcfceflfmfgedkcfbommgcfk';   // the manifest key's ID (Load unpacked)
  const call = (url, body, token = '') => fetch(`http://127.0.0.1:${server.PORT}${url}`, {method: 'POST', body: JSON.stringify(body),
    headers: {Origin: `chrome-extension://${FOLDER}`, 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}});
  try {
    const {token} = await (await call('/extension/pair', {})).json();
    // This test runs in a checkout: a development copy, which counts the reload (the packaged rule is the pure test above).
    const first = await call('/extension/tabs', {urls: [], version: '0.9.756', reloadedFor: '0.9.759'}, token);
    assert.equal(first.status, 200);
    assert.equal(server.extensionSeen().version, '0.9.759');
    assert.equal(server.extensionSeen().id, FOLDER);
    await call('/extension/tabs', {urls: [], version: '0.9.756'}, token);
    assert.equal(server.extensionSeen().version, '0.9.756', 'no reload recorded: the manifest');
  } finally { running?.close?.(); }
});
