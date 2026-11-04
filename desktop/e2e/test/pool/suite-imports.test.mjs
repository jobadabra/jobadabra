// Every suite loads with only the packages desktop/e2e installs: the plan job imports every suite and runs `npm ci` in desktop/e2e alone.
// Guard: release — a suite that reaches an app module importing a package desktop/e2e does not list ('@anthropic-ai/sdk' through agent-seed.mjs → cv-check.js, main run 41805737631, 4 Nov 2026) stops the plan of every e2e run and the beta.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {builtinModules} from 'node:module';
import {fileURLToPath} from 'node:url';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;   // loaded with the file; `import('x')` inside a function is lazy and is not matched on purpose
const installed = () => { const manifest = JSON.parse(fs.readFileSync(path.join(E2E, 'package.json'), 'utf8')); return new Set([...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.devDependencies || {})]); };
const packageOf = spec => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
const isBuiltin = spec => spec.startsWith('node:') || builtinModules.includes(packageOf(spec));
const resolveFile = (from, spec) => { const base = path.resolve(path.dirname(from), spec); return [base, `${base}.js`, `${base}.mjs`].find(file => fs.existsSync(file) && fs.statSync(file).isFile()) || null; };

/** The packages a file brings in when it is loaded, with the chain of files that reached each: `[{pkg, chain: [file, ...]}]`. Follows relative static imports only. */
export function packagesLoadedBy(entry) {
  const found = [], seen = new Set([entry]), queue = [[entry, [entry]]];
  while (queue.length) {
    const [file, chain] = queue.shift();
    const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const spec = match[1] || match[2];
      if (spec.startsWith('.')) { const next = resolveFile(file, spec); if (next && !seen.has(next)) { seen.add(next); queue.push([next, [...chain, next]]); } }
      else if (!isBuiltin(spec)) found.push({pkg: packageOf(spec), chain});
    }
  }
  return found;
}

test('every suite loads with the packages desktop/e2e installs', () => {
  const have = installed(), repo = path.resolve(E2E, '..', '..');
  const suites = fs.readdirSync(path.join(E2E, 'suites')).filter(name => name.endsWith('.mjs'));
  assert.ok(suites.length > 5, 'the suites folder was found');
  const missing = [];
  for (const suite of suites) for (const {pkg, chain} of packagesLoadedBy(path.join(E2E, 'suites', suite))) if (!have.has(pkg)) missing.push(`${chain.map(file => path.relative(repo, file)).join(' → ')} imports "${pkg}"`);
  assert.deepEqual([...new Set(missing)], [], 'a suite reaches a package the plan job does not install (desktop/e2e/package.json); take the helper from a module that imports no package');
});
