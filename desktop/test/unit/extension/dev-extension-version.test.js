// A development copy is told a higher version after each pull, and the running extension reloads for it without looking stale afterwards (desktop/lib/dev-extension-version.js, extension/tab-report.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {devVersion} from '../../../lib/dev-extension-version.js';

const git = counts => (cmd, args) => { const sub = args.slice(2).join(' '); return sub.startsWith('rev-parse') ? 'false' : String(counts.shift()); };

test('the stamped version rises with the commits that changed extension/', () => {
  const run = git([300, 301]);
  assert.equal(devVersion('/r1', '0.9', {now: 0, run}), '0.9.300');
  assert.equal(devVersion('/r1', '0.9', {now: 1000, run}), '0.9.300', 'cached within the window');
  assert.equal(devVersion('/r1', '0.9', {now: 60000, run}), '0.9.301', 'a pull is seen after it');
});

test('without git the manifest version stands', () => {
  assert.equal(devVersion('/r2', '0.9', {now: 0, run: () => { throw new Error('no git'); }}), '0.9');
});

// Why (7 Nov 2026, owner's 0.9.13 retest, replacing the old rule that the bare manifest is never reported): the report sends the manifest as version and the stamped version apart as reloadedFor; the app counts the stamped one only for a development copy (lib/extension-version.js). Sending the stamped one as version hid a reload that did not take.
test('the report sends the manifest version apart from the version it reloaded for; the reload compare still uses the running one', () => {
  const code = fs.readFileSync(new URL('../../../../extension/tab-report.js', import.meta.url), 'utf8');
  assert.match(code, /version: manifest, reloadedFor: reloaded/);
  assert.doesNotMatch(code, /version: running/);
  assert.match(code, /mayReloadSelf\(\{latest: answer\?\.latest, running,/);
  assert.match(fs.readFileSync(new URL('../../../../extension/self-reload.js', import.meta.url), 'utf8'), /newer\(latest, running\)/);
  assert.doesNotMatch(code, /newer\(answer\.latest, chrome\.runtime\.getManifest/);
});
