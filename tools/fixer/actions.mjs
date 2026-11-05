// What the loop's four doing-actions really do on the workspace: read, search, edit (behind the walls) and run_tests (only in the no-network box). The AI names an action; this file performs it (4 Nov 2026, [hm] 3/6).
// Trust: runs from the workflow's snapshot, never from a folder the AI may edit. Every result is a short text that goes back to the AI only; the run's log gets none of it (the repository is PUBLIC and a result may quote data).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {MAX_FILES, MAX_PATCH_BYTES, gateChange} from './walls.mjs';
import {TESTS} from './proof.mjs';

const SKIP = /^(?:\.git|\.fb|node_modules|e2e-artifacts)$/;   // never read, listed or searched: git internals, the run's work folder, installed packages
const RESULT_CHARS = 6000, READ_LINES = 200, MATCHES = 40;

/** The workspace file `rel` names, or {why}: a relative path inside `cwd` that is no git internal and whose real location (symlinks resolved) is still inside `cwd`. */
function resolve(cwd, rel) {
  let name = String(rel || '').trim();
  if (name === '.') return {name, full: cwd};   // the repository itself (a search of the whole tree)
  if (!name || name.includes('\0') || path.isAbsolute(name) || name.split('/').some(part => part === '..' || SKIP.test(part))) return {why: 'that path is not one you may use (a relative path inside the repository)'};
  name = path.posix.normalize(name);   // 'src/./a.py' and 'src/a.py' are one file (the file cap counts it once)
  const full = path.join(cwd, name), root = fs.realpathSync(cwd);
  let near = path.dirname(full);
  while (!fs.existsSync(near)) near = path.dirname(near);   // a new file may start a new folder: the nearest folder that exists must still be inside
  const real = fs.realpathSync(near);
  if (real !== root && !real.startsWith(root + path.sep)) return {why: 'that path leaves the repository'};
  return {name, full};
}

/**
 * The loop's `act`. `cwd` = the workspace; `allow` = RegExp of the paths an edit may touch (walls.mjs EDITABLE); `boxRun(files)` -> {ok, output} runs test files in the no-network box on a fresh copy of the workspace.
 * -> {act, changed()}: `act(action)` -> {text, edited?, passed?} and never throws on a bad input (a refusal is a text); `changed()` = the files this run edited or created.
 */
export function createActs({cwd, allow, boxRun}) {
  const files = new Set();
  let bytes = 0;
  const cut = text => (text.length > RESULT_CHARS ? `${text.slice(0, RESULT_CHARS)}\n… (cut)` : text);
  const lstat = full => { try { return fs.lstatSync(full); } catch { return null; } };

  function read({path: rel, range}) {
    const at = resolve(cwd, rel), stat = at.full && lstat(at.full);
    if (at.why) return {text: `Refused: ${at.why}.`};
    if (!stat?.isFile()) return {text: 'Refused: no such file (a symlink or a folder is not read).'};
    const [from, to] = /^(\d+)-(\d+)$/.test(range || '') ? range.split('-').map(Number) : [1, READ_LINES], start = Math.max(1, from), end = Math.min(to, start + READ_LINES - 1);
    return {text: cut(fs.readFileSync(at.full, 'utf8').split('\n').slice(start - 1, end).map((line, i) => `${start + i}: ${line.slice(0, 300)}`).join('\n') || '(nothing in that range)')};
  }

  function search({pattern, folder}) {
    const needle = String(pattern || '').toLowerCase(), at = resolve(cwd, folder || '.');
    if (needle.length < 2) return {text: 'Refused: search for at least 2 characters of literal text.'};
    if (at.why || !lstat(at.full)?.isDirectory()) return {text: `Refused: ${at.why || 'not a folder (a link is not followed)'}.`};
    const hits = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        if (hits.length >= MATCHES || SKIP.test(entry.name) || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && fs.statSync(full).size < 1e6) {
          fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => { if (hits.length < MATCHES && line.toLowerCase().includes(needle)) hits.push(`${path.relative(cwd, full)}:${i + 1}: ${line.trim().slice(0, 200)}`); });
        }
      }
    };
    walk(at.full);
    return {text: hits.length ? hits.join('\n') : '(no match)'};
  }

  function edit({path: rel, old, new: next}) {
    const at = resolve(cwd, rel);
    if (at.why) return {text: `Refused: ${at.why}.`};
    if (!allow.test(at.name)) return {text: 'Refused: outside the folders a fix may touch (src/, desktop/renderer/, desktop/lib/ and their tests).', wall: true};   // `wall`: the run record's "blocked by the walls" (5/7)
    const stat = lstat(at.full), before = old === '' ? null : stat?.isFile() ? fs.readFileSync(at.full, 'utf8') : null;
    if (stat && !stat.isFile()) return {text: 'Refused: that is a link or a folder.'};
    if (old === '' ? stat : before === null) return {text: old === '' ? 'Refused: the file exists already; an edit needs the old text.' : 'Refused: no such file.'};
    const count = old === '' ? 1 : before.split(old).length - 1;
    if (count !== 1) return {text: `Refused: the old text occurs ${count} times, not once.`};
    const why = gateChange([...new Set([...files, at.name])], bytes + Buffer.byteLength(old) + Buffer.byteLength(next));
    if (why) return {text: `Refused: ${why}.`, wall: true};   // the wall's answer is final; the edit is never shrunk or repaired
    fs.mkdirSync(path.dirname(at.full), {recursive: true});
    fs.writeFileSync(at.full, old === '' ? next : before.replace(old, () => next));
    files.add(at.name); bytes += Buffer.byteLength(old) + Buffer.byteLength(next);
    return {text: `Edited ${at.name} (${files.size} of ${MAX_FILES} files, ${bytes} of ${MAX_PATCH_BYTES} bytes).`, edited: true};
  }

  function runTests({files: list}) {
    const tests = [...new Set(Array.isArray(list) ? list.map(String) : [])];
    if (!tests.length || tests.length > 4 || !tests.every(file => TESTS.test(file))) return {text: 'Refused: name 1 to 4 test files: desktop/test/unit/<scope>/<name>.test.js or tests/unit/<scope>/test_<name>.py.'};
    const missing = tests.filter(file => !lstat(path.join(cwd, file))?.isFile());
    if (missing.length) return {text: `Refused: no such test file: ${missing.join(', ')}.`};
    const run = boxRun(tests);
    return {text: `${run.ok ? 'PASSED' : 'FAILED'}\n${cut(String(run.output || '').slice(-RESULT_CHARS))}`, passed: run.ok};
  }

  const table = {read, search, edit, run_tests: runTests};
  return {act: async action => (table[action.action] ? table[action.action](action) : {text: `Refused: ${action.action} is not an action you can use here.`}), changed: () => [...files]};
}

/** Puts the workspace back to the commit (tracked files and new ones; ignored folders such as node_modules stay): a run that ends without a fix must leave no edit for the next step to find. */
export function discard(cwd = '.') {
  execFileSync('git', ['reset', '-q', '--hard', 'HEAD'], {cwd});
  execFileSync('git', ['clean', '-fdq'], {cwd});
}
