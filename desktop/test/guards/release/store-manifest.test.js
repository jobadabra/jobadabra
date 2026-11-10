// Guard: release — the Store package asks for no restricted capability except runFullTrust; Microsoft denied unvirtualizedResources on 10 Nov 2026 and failed the whole update (Partner Center report, rule 10.6.3).
// Why (10 Nov 2026, owner: "Drop it (Recommended)"): the Store build once edited the manifest (AppData write virtualization off + unvirtualizedResources) so the Store and .exe copies shared one data folder; the Store refuses that capability.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const require = createRequire(import.meta.url);
const workflow = fs.readFileSync(new URL('../../../../.github/workflows/msix-store.yml', import.meta.url), 'utf8');
const APPX_FLAGS = ['identityName', 'publisher', 'publisherDisplayName', 'displayName', 'applicationId', 'minVersion', 'maxVersionTested'];   // identity and version only; none adds a capability
const build = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).build;

test('the Store build uses electron-builder\'s own manifest: no custom manifest and no extra capability on the command line', () => {
  assert.doesNotMatch(workflow, /customManifestPath/);
  assert.doesNotMatch(workflow, /appx\.capabilities/);
  assert.doesNotMatch(workflow, /unvirtualizedResources|FileSystemWriteVirtualization/);
  const flags = [...workflow.matchAll(/-c\.appx\.(\w+)/g)].map(match => match[1]);
  assert.deepEqual(flags.filter(flag => !APPX_FLAGS.includes(flag)), [], 'a new -c.appx flag: check it cannot add a restricted capability, then list it');
  assert.ok(!fs.existsSync(new URL('../../../scripts/appx-manifest.mjs', import.meta.url)), 'a script that edits the Store manifest is back');
});

test('the capabilities the package would declare are runFullTrust only', () => {
  const AppXTarget = require('app-builder-lib/out/targets/AppxTarget').default;
  const xml = AppXTarget.prototype.getCapabilities.call({options: build.appx || {}});
  assert.deepEqual([...xml.matchAll(/Capability Name="([^"]+)"/g)].map(match => match[1]), ['runFullTrust']);
});
