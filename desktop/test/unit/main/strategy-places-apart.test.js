// Strategy's places never meet the Profile's (owner, 12 Nov 2026, #3850: "Location in the strategy, should not be conflicted/mixed with the location
// from the profile… I can have one location in profile, but looking for another location in my search strategy"). The owner's scenario: a Profile
// that names Switzerland and a Strategy that searches Germany. Nothing on the Strategy page or behind it compares the two: no conflict card, no IPC that
// reads the Profile's places, no Profile place copied into the search. Fails on the code before #3850 (the "Which locations are right?" card and its
// locationsWhich / resolveLocationConflict channels).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {mainSource} from '../../main-source.js';

const here = path.resolve(import.meta.dirname, '../../..');
const read = file => fs.readFileSync(path.join(here, file), 'utf8');

test('a Profile in Switzerland and a Strategy in Germany: the Strategy page has no card that asks which places are right', () => {
  const html = read('renderer/index.html');
  assert.doesNotMatch(html, /Which locations are right\?/);
  assert.doesNotMatch(html, /Your Profile name different places/);
  assert.doesNotMatch(read('renderer/pages/strategy.js'), /locations-which|LocationsWhich/, 'the Strategy page loads no place comparison');
});

test('no channel compares or copies places between the Profile and the search settings', () => {
  for (const channel of ['locationsWhich', 'resolveLocationConflict']) {
    assert.doesNotMatch(read('preload.cjs'), new RegExp(`call\\('${channel}'\\)`), channel);
    assert.doesNotMatch(mainSource(), new RegExp(`handle\\('${channel}'`), channel);
  }
  for (const file of fs.readdirSync(path.join(here, 'lib')).filter(name => name.startsWith('locations-'))) {
    assert.doesNotMatch(read(`lib/${file}`), /page\('profile'\)/, `${file} reads the Profile page`);
  }
});
