// Class guard (fx, 3 Nov 2026, Windows tester's 0.9.2 Edit crash): querySelectorAll returns a NodeList in Electron (forEach and iteration only), but tiny-dom
// returns an Array, so `list.querySelectorAll(x).map(...)` passed every render test and threw in the app. No renderer file may call an Array method on a
// querySelectorAll result, directly or through a variable it was assigned to; spread it first: [...list.querySelectorAll(x)].map(...).
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../renderer', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(name => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : name.endsWith('.js') ? [join(dir, name)] : []));
const METHODS = 'map|filter|find|findLast|findIndex|some|every|reduce|reduceRight|slice|flatMap|flat|at|includes|indexOf|join|concat|sort|reverse';
const direct = new RegExp(String.raw`querySelectorAll\??\.?\([^)]*\)\s*\??\.(${METHODS})\b`);
const assigned = /(?:const|let|var)\s+(\w+)\s*=\s*[\w.$()?[\]'"-]*?\.querySelectorAll\([^)]*\)\s*[;,\n]/g;

test('no renderer file calls an Array method on a querySelectorAll NodeList', () => {
  const found = [];
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const text = lines.join('\n');
    lines.forEach((line, i) => { if (direct.test(line)) found.push(`${file.slice(root.length + 1)}:${i + 1} ${line.trim().slice(0, 100)}`); });
    for (const [, name] of text.matchAll(assigned)) {
      const use = new RegExp(String.raw`\b${name}\s*\.(${METHODS})\b`);
      lines.forEach((line, i) => { if (use.test(line)) found.push(`${file.slice(root.length + 1)}:${i + 1} ${name} is a NodeList: ${line.trim().slice(0, 100)}`); });
    }
  }
  assert.deepEqual(found, [], 'spread first: [...x.querySelectorAll(sel)].map(...)');
});

test('the guard sees the shapes it names', () => {
  assert.ok(direct.test("row.querySelectorAll('input').map(x => x)"));
  assert.ok(direct.test("x?.querySelectorAll?.('input').map(y => y)"));
  assert.ok(!direct.test("[...row.querySelectorAll('input')].map(x => x)"));
});
