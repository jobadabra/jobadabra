// Guard: privacy — a person's news answer is theirs alone: the app must never send a `marketing` answer of its own (an echo of an old copy took back a person's yes when they turned on Always on, hosted-suggestion.js sent `false`).
// Owner, 6 Nov 2026: "I like the 2 switches" (News from Jobadabra: What's new, News and tips). Only a press on one of those switches (lib/mail-choices.js NEWS) changes the answer, on the site.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));   // the repo root, so the extension is read too
const walk = dir => readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => entry.name === 'node_modules' ? [] : entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
// A `marketing` key or variable, the old setting and its reader, the old tick. Whole-line comments are skipped: they may say why it is gone.
const SENDS_NEWS = /\bmarketing\s*[:=,}]|\bnotifyMarketing\b|\bwantsNews\b|notify-marketing|\.marketing\b/;

test('no app or extension source sends, keeps or reads a news answer of its own', () => {
  const files = [...walk('desktop/lib'), ...walk('desktop/renderer'), ...walk('extension'), 'desktop/main.js', 'desktop/preload.cjs'].filter(file => /\.(js|cjs|mjs|html)$/.test(file));
  const found = files.flatMap(file => readFileSync(join(root, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line.trim()])
    .filter(([, , line]) => !/^(\/\/|\*|\/\*|<!--)/.test(line) && SENDS_NEWS.test(line)).map(([f, n, line]) => `${f}:${n}: ${line.slice(0, 100)}`));
  assert.deepEqual(found, []);
});
