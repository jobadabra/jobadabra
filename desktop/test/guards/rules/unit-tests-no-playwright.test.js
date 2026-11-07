// A desktop unit test must not reach playwright-core through its imports: the desktop unit job on CI installs only desktop/, not desktop/e2e (11 Oct 2026: main went red when claim-shape.test.js imported a lib that imported app.mjs for a path).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {testFiles} from '../../test-files.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Why (7 Nov 2026, ts 7/7, owner: "windows unit tests are still very slow"): every test file re-read its whole import closure (134k reads, 834 MB, 15.7 s on a Windows runner); a file's imports are now read once and the closures are walked in memory. Same hits, same text.
const parsed = new Map();   // file -> {deps: resolved relative imports, hits: "<file> -> <playwright spec>"}
function parse(file) {
  if (parsed.has(file)) return parsed.get(file);
  const entry = {deps: [], hits: []};
  parsed.set(file, entry);
  if (!fs.existsSync(file) || !/\.(m?js)$/.test(file)) return entry;
  const text = fs.readFileSync(file, 'utf8');
  for (const found of text.matchAll(/(?:from\s+|import\s*\(\s*)'([^']+)'/g)) {
    const spec = found[1];
    if (spec.startsWith('.')) entry.deps.push(path.resolve(path.dirname(file), spec));
    else if (/^playwright/.test(spec)) entry.hits.push(`${path.relative(here, file)} -> ${spec}`);
  }
  return entry;
}

// -> the files that name playwright, reachable from `file` by relative imports (static `from '...'` and import('...') with a literal).
function reaches(file, seen = new Set(), hits = []) {
  if (seen.has(file)) return hits;
  seen.add(file);
  const entry = parse(file);
  hits.push(...entry.hits);
  for (const dep of entry.deps) reaches(dep, seen, hits);
  return hits;
}

test('no desktop unit test reaches playwright through its imports', () => {
  const found = testFiles().filter(file => file.endsWith('.test.js')).flatMap(file => reaches(file).map(hit => `${path.relative(here, file)}: ${hit}`));
  assert.deepEqual(found, [], 'move the path or constant into a file that does not import playwright (the desktop unit job does not install it)');
});

test('the walker sees an import chain to playwright (positive control)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-walk-'));
  fs.writeFileSync(path.join(dir, 'a.mjs'), "import {x} from './b.mjs';\n");
  fs.writeFileSync(path.join(dir, 'b.mjs'), `import {chromium} from '${'play' + 'wright-core'}';\nexport const x = 1;\n`);   // spelled in two pieces: this file must not name the module itself
  assert.equal(reaches(path.join(dir, 'a.mjs')).length, 1);
  fs.rmSync(dir, {recursive: true, force: true});
});
