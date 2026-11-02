// /admin/agents/overview: the category map covers every tracked file, a PR's main category, the once-only ingest and its one-row snapshot, and the page in each state.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {CATEGORIES, CATEGORY_IDS, TOP_LEVEL, categoryOfFile, classify, prRow} from '../../tools/ci-intel/lib/ops-categories.mjs';

test('every tracked file has a category, and every top-level path of the repo is named (add a new one to TOP_LEVEL)', () => {
  const files = execFileSync('git', ['ls-files'], {cwd: new URL('../..', import.meta.url), encoding: 'utf8', maxBuffer: 1 << 26}).split('\n').filter(Boolean);
  assert.ok(files.length > 100);
  const none = files.filter(file => !categoryOfFile(file));
  assert.deepEqual(none.slice(0, 10), [], 'files without a category: add a rule or a TOP_LEVEL entry in admin/ops-categories.js');
  const tops = [...new Set(files.filter(file => file.includes('/')).map(file => file.split('/')[0]))];
  assert.deepEqual(tops.filter(top => !TOP_LEVEL[top]), [], 'top-level paths without a category');
  assert.ok(CATEGORY_IDS.every(id => CATEGORIES.find(category => category.id === id).label));
});

test('a PR gets the category of most changed non-test lines; tests alone are "tests"; no majority is "mixed"; a Pool-row trailer is a form fix only with fill code', () => {
  const f = (path, lines) => ({path, additions: lines, deletions: 0});
  assert.equal(classify([f('extension/ladder/x.js', 40), f('site/src/a.js', 10), f('desktop/test/a.test.js', 500)]).category, 'forms');
  assert.equal(classify([f('tools/a.mjs', 5), f('tests/test_a.py', 50)]).category, 'ci');
  assert.equal(classify([f('tests/test_a.py', 5), f('test/b.test.js', 5)]).category, 'tests');
  const mixed = classify([f('tools/a.mjs', 10), f('site/src/a.js', 10), f('docs/a.md', 10), f('desktop/main.js', 10)]);
  assert.deepEqual([mixed.category, mixed.mixed], ['mixed', true]);
  assert.equal(classify([f('docs/a.md', 5)], ['Fix']).category, 'docs');
  // A Pool-row trailer is a form fix only together with fill code (coordinator, 15 Oct 2026); then the recorded pages count with the fix; pool postings are "Pool data".
  const fix = ['Fix\n\nPool-row: Chanel Workday'];
  assert.equal(classify([f('extension/ladder/x.js', 20), f('desktop/e2e/recorded/a/page.json', 90), f('tools/a.mjs', 10)], fix).category, 'forms');   // like #838
  assert.equal(classify([f('desktop/e2e/record-sites.mjs', 90), f('tools/a.mjs', 50)], fix).category, 'replay');   // a harness PR with a trailer is not a fix
  assert.equal(classify([f('tools/a.mjs', 5)], ['Pool-row:']).category, 'ci');
  assert.equal(classify([f('desktop/e2e/recorded/a/page.json', 90)], fix).category, 'replay');   // proof alone is not a fix
  assert.equal(classify([f('desktop/e2e/recorded/a/page.json', 90), f('desktop/lib/ladder/a.js', 5)], ['Fix']).category, 'forms');
  assert.equal(classify([f('worker/src/answer-facts.js', 5), f('tools/a.mjs', 50)], fix).category, 'forms');
  assert.equal(categoryOfFile('desktop/e2e/ladder-fixtures/a.json'), 'forms');
  assert.equal(categoryOfFile('desktop/e2e/smoke-sites.json'), 'pool');
  assert.equal(classify([f('desktop/e2e/smoke-sites.json', 6)]).category, 'pool');
  assert.equal(categoryOfFile('desktop/e2e/record-sites.mjs'), 'replay');
  assert.equal(categoryOfFile('desktop/e2e/lib/extension.mjs'), 'ci');
  assert.equal(categoryOfFile('desktop/lib/ladder/moves.js'), 'forms');
  assert.equal(categoryOfFile('.claude/skills/x/SKILL.md'), 'docs');
  const row = prRow({number: 7, title: 'T', createdAt: '2026-10-15T06:00:00Z', mergedAt: '2026-10-15T09:30:00Z', files: [f('site/src/a.js', 3)], commits: []}, 12.34);
  assert.deepEqual([row.category, row.hours, row.ciMinutes, row.lines], ['site', 3.5, 12.3, 3]);
});
