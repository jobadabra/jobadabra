// Guard: data — a hub pointing at a vanished file, anchor or source sends the fixer agent nowhere (docs/map/, tools/context/check-map.mjs); also keeps AGENTS.md under Codex's 32 KiB cap.
// The real map must hold, and a small bad map must be refused for each class of problem (one loop, one temp folder per case).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {AGENTS_MAX, HUB_MAX, L0_MAX, checkMap} from '../../../../tools/context/check-map.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');

const HUB = (extra = '', front = 'area: demo\npaths: [src]\nupdated: 2026-11-03') => `---\n${front}\n---\n# Demo\n${extra}\n`;
function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-check-'));
  fs.mkdirSync(path.join(dir, 'docs', 'map'), {recursive: true});
  fs.mkdirSync(path.join(dir, 'src'));
  for (const [name, text] of Object.entries({'docs/map/index.md': '# Map\n[demo](demo.md)\n', 'docs/map/demo.md': HUB(), ...files})) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test('the real map holds: sizes, links, anchors, paths, sources, leaks and the AGENTS.md cap', () => {
  assert.deepEqual(checkMap(root), []);
});

test('a bad map is refused for each class of problem', () => {
  assert.deepEqual(checkMap(tree({})), [], 'the stand-in map itself is clean');
  const cases = {
    'a link to a missing file': [{'docs/map/demo.md': HUB('[x](nope.md)')}, /nope\.md, which does not exist/],
    'a link to a missing anchor': [{'docs/map/demo.md': HUB('[x](index.md#nowhere)')}, /no such heading or anchor/],
    'a path that does not exist': [{'docs/map/demo.md': HUB('', 'area: demo\npaths: [gone/file.js]\nupdated: 2026-11-03')}, /gone\/file\.js, which does not exist/],
    'no front matter': [{'docs/map/demo.md': '# Demo\n'}, /needs front matter/],
    'an unknown ask source': [{'docs/map/demo.md': HUB('ask: carrier-pigeon letters')}, /unknown source "carrier-pigeon"/],
    'an e-mail address': [{'docs/map/demo.md': HUB('write to someone@example.com')}, /e-mail address/],
    'an oversize hub': [{'docs/map/demo.md': HUB('x'.repeat(HUB_MAX))}, /over its 6144 budget/],
    'an oversize index': [{'docs/map/index.md': '# Map\n[demo](demo.md)\n' + 'x'.repeat(L0_MAX)}, /over its 3072 budget/],
    'a hub the index does not link': [{'docs/map/index.md': '# Map\n'}, /not linked from docs\/map\/index\.md/],
    'an AGENTS.md over the Codex cap': [{'AGENTS.md': 'x'.repeat(AGENTS_MAX + 1)}, /AGENTS\.md is over 32768 bytes/],
  };
  for (const [name, [files, expected]] of Object.entries(cases)) {
    const problems = checkMap(tree(files));
    assert.ok(problems.some(p => expected.test(p)), `${name}: expected ${expected}, got ${JSON.stringify(problems)}`);
  }
});
