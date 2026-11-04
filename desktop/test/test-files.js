// Every desktop test file, for the guards that read them all: the same files `npm test` runs (test/*.test.js and test/{unit,guards,tooling}/**/*.test.js).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
// Why (3 Nov 2026, test folders 3/3, TESTS.md): tests live in unit/, guards/ and tooling/ by type and scope; helpers and fixtures stay at the top.
const KINDS = ['unit', 'guards', 'tooling'];

/**
 * The absolute paths of every desktop test file (`*.test.js` or `*.test.mjs`), sorted.
 * Invariant: never a helper or a fixture; a file at the top of test/ still counts, so a test not yet moved is still read.
 */
export function testFiles() {
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.test\.m?js$/.test(entry.name) ? [full] : [];
  });
  const top = fs.readdirSync(TEST_DIR).filter(name => /\.test\.m?js$/.test(name)).map(name => path.join(TEST_DIR, name));
  return [...top, ...KINDS.filter(kind => fs.existsSync(path.join(TEST_DIR, kind))).flatMap(kind => walk(path.join(TEST_DIR, kind)))].sort();
}
