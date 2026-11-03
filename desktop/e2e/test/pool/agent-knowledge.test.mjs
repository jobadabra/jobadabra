// The AI user agent's knowledge (lib/agent-knowledge.mjs, agent-memory.mjs): the expectation files parse and cite a source, a changed file puts its area into the plan, an entry citing changed code is stale, the write-back merges and forgets, and the notes branch is pushed to a real remote.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {areaOf, changedLines, changedSince, knowledgeFor, markStale, mergeNotes, parseExpectations, parseNotes, renderNotes, verdictLine} from '../../lib/agent-knowledge.mjs';
import {memoryFiles, pushMemory, readExpectations, readNotes} from '../../lib/agent-memory.mjs';
import {planSession} from '../../lib/agent-plan.mjs';

const EXPECTATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', 'app-expectations');
const LOG = `@@aaaa1111\t[x] Focus shows the quick check again (#1)
desktop/renderer/pages/focus-check.js
desktop/test/focus-check.test.js
@@bbbb2222\tProfile: no heading is saved as an answer (#2)
desktop/renderer/pages/application-answers.js
desktop/lib/about-you.js
@@cccc3333\tA new folder nobody mapped (#3)
desktop/renderer/pages/zoo-new.js
docs/x.md
`;

test('the real expectation files parse, every rule has a source, ids are unique and carry their area', () => {
  const all = Object.entries(readExpectations(EXPECTATIONS));
  assert.ok(all.length >= 6, 'at least six areas are seeded');
  const ids = new Set();
  for (const [area, entries] of all) for (const entry of entries) {
    assert.ok(entry.source.length > 3, `${entry.id} has no source`);
    assert.ok(entry.id.startsWith(`${area.toLowerCase()}-`), `${entry.id} is in the ${area} file`);
    assert.ok(!ids.has(entry.id), `${entry.id} twice`);
    ids.add(entry.id);
    for (const file of entry.code) assert.ok(fs.existsSync(path.resolve(EXPECTATIONS, '..', '..', file)), `${entry.id} cites ${file}, which does not exist`);
    for (const source of [entry.source.split(' ')[0]].filter(each => /^(docs|desktop|tests|src)\//.test(each))) assert.ok(fs.existsSync(path.resolve(EXPECTATIONS, '..', '..', source)), `${entry.id} cites ${source}, which does not exist`);
  }
});

test('a malformed rule line is an error, never skipped', () => {
  assert.throws(() => parseExpectations('# Jobs\n- [jobs-9] a rule with no source', 'Jobs'), /not "- \[id\] rule/);
  assert.deepEqual(parseExpectations('# Jobs\n\n- [jobs-1] Rule. | source: owner | code: a.js, b.js\n- [jobs-2] Other. | source: PR #1 | code: -', 'Jobs').map(entry => entry.code), [['a.js', 'b.js'], []]);
});

test('a changed file puts its area into the plan; a test or doc file does not; a new folder is reported unmapped', () => {
  const changed = changedSince(LOG, {bbbb2222: 'Profile: no heading is saved as an answer'});
  assert.deepEqual(changed.areas, ['Focus', 'Profile']);
  assert.deepEqual(changed.unmapped, ['desktop/renderer/pages/zoo-new.js']);
  assert.equal(areaOf('desktop/test/focus-check.test.js'), null);
  assert.equal(areaOf('docs/superpowers/specs/x.md'), null);
  const moves = ['Focus', 'Profile', 'Jobs', 'Strategy', 'Settings', 'Actions'].flatMap(group => [1, 2, 3].map(n => ({group, label: `${group} ${n}`})));
  for (const seed of [1, 2, 3, 4]) assert.deepEqual(['Focus', 'Profile'].filter(area => !planSession({seed, moves, changed: changed.areas}).goals.some(goal => goal.group === area)), []);
});

test('the changed list is one line per change, newest first, capped, with the PR verdict when there is one', () => {
  const lines = changedLines(changedSince(LOG, {aaaa1111: 'Focus shows the quick check again'}), 2);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^- aaaa1111 Focus shows the quick check again \[Focus\]$/);
  assert.equal(verdictLine('## 🟢 **Inbound rows** read like Jobs rows.\n\n> note'), '🟢 Inbound rows read like Jobs rows.');
  assert.equal(verdictLine('no heading here'), '');
});

test('an entry citing changed code is marked stale, and the knowledge text says so', () => {
  const entries = markStale(parseExpectations('- [actions-2] A button entry brings you to it. | source: nav | code: desktop/renderer/pages/nav.js', 'Actions'), ['desktop/renderer/pages/nav.js']);
  assert.deepEqual(entries[0].stale, ['desktop/renderer/pages/nav.js']);
  assert.match(knowledgeFor(['Actions'], {expectations: {Actions: entries}}), /actions-2 A button entry brings you to it\. \(stale: re-verify, desktop\/renderer\/pages\/nav\.js changed\)/);
  assert.deepEqual(markStale(entries, [])[0].stale, []);
});

test('the write-back merges the same observation, counts it, and forgets what was not seen for 30 days', () => {
  const day1 = mergeNotes([], ['The Board view hides the Show menu.', 'Sort resets on reload'], {today: '2026-11-03', commit: 'abc1234', session: 's1'});
  assert.deepEqual(day1.map(note => note.seen), [1, 1]);
  const day2 = mergeNotes(day1, ['the board view hides the show menu', 'A new thing'], {today: '2026-11-04', commit: 'def5678', session: 's2'});
  assert.deepEqual(day2.map(note => [note.text, note.seen, note.first, note.last, note.commit]), [
    ['The Board view hides the Show menu.', 2, '2026-11-03', '2026-11-04', 'def5678'], ['Sort resets on reload', 1, '2026-11-03', '2026-11-03', 'abc1234'], ['A new thing', 1, '2026-11-04', '2026-11-04', 'def5678']]);
  const later = mergeNotes(day2, [], {today: '2026-12-10'});
  assert.deepEqual(later, [], 'all older than 30 days');
  assert.deepEqual(parseNotes(renderNotes('Jobs', day2)), day2.map(note => ({...note})), 'a note survives render and parse');
});

test('the knowledge text keeps every rule and drops the oldest notes first when it is over the cap', () => {
  const expectations = {Jobs: parseExpectations('- [jobs-1] Rule one. | source: s | code: -', 'Jobs')};
  const notes = {Jobs: Array.from({length: 40}, (_, i) => ({text: `note number ${i} ${'x'.repeat(100)}`, seen: 1, last: `2026-10-${String(i % 28 + 1).padStart(2, '0')}`}))};
  const text = knowledgeFor(['Jobs'], {expectations, notes, maxTokens: 300});
  assert.match(text, /jobs-1 Rule one\./);
  assert.ok(Math.ceil(text.length / 4) <= 300);
  assert.ok((text.match(/- note:/g) || []).length < 40);
});

// A real local remote: the first night creates the orphan branch, the second adds to it, an unchanged night pushes nothing, main is untouched.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memory-')), remote = path.join(root, 'remote.git'), work = path.join(root, 'work');
  const run = (args, cwd) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  run(['init', '--bare', '--quiet', '--initial-branch=main', remote]);
  run(['clone', '--quiet', remote, work]);
  fs.writeFileSync(path.join(work, 'README.md'), 'main\n');
  run(['add', '-A'], work);
  run(['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '--quiet', '-m', 'main'], work);
  run(['push', '--quiet', 'origin', 'HEAD:main'], work);
  return {root, remote, work, git: args => run(args, work), run};
}

test('the notes branch: created on the first night, extended on the second, nothing pushed when nothing changed, main untouched', () => {
  const {remote, work, git, run} = setup();
  const night1 = memoryFiles({Jobs: mergeNotes([], ['Board hides the Show menu'], {today: '2026-11-03'}), Focus: []});
  assert.deepEqual(Object.keys(night1), ['notes/jobs.md'], 'an area without notes writes no file');
  assert.deepEqual(pushMemory({dir: work, files: night1, git, message: 'night 1'}), {pushed: true});
  assert.match(run(['ls-tree', '-r', '--name-only', 'agent-memory'], remote), /^notes\/jobs\.md$/m);
  assert.equal(run(['show', 'main:README.md'], remote), 'main\n');

  // Night 2 in a fresh clone (a new runner): read the branch, merge, write back.
  const second = path.join(path.dirname(work), 'work2');
  run(['clone', '--quiet', '--branch', 'agent-memory', remote, second]);
  const git2 = args => run(args, second);
  const merged = mergeNotes(readNotes(second).Jobs, ['Board hides the Show menu', 'Sort resets'], {today: '2026-11-04'});
  assert.deepEqual(pushMemory({dir: second, files: memoryFiles({Jobs: merged}), git: git2, message: 'night 2'}), {pushed: true});
  assert.deepEqual(parseNotes(run(['show', 'agent-memory:notes/jobs.md'], remote)).map(note => [note.text, note.seen]), [['Board hides the Show menu', 2], ['Sort resets', 1]]);
  assert.deepEqual(pushMemory({dir: second, files: memoryFiles({Jobs: merged}), git: git2, message: 'night 3, same'}), {pushed: false});
  assert.equal(run(['show', 'main:README.md'], remote), 'main\n');
});
