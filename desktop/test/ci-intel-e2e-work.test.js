// Where e2e work goes (admin/e2e-work.js): one kind per commit from its paths, product first, plumbing only when nothing else was touched; weekly harness hot files.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kindOfCommit, parseLog, weekOf, workRows, WORK_IDS} from '../../tools/ci-intel/lib/e2e-work.mjs';

test('a commit takes the first kind its files match: product, expectations, plumbing, unit tests, other', () => {
  assert.equal(kindOfCommit(['desktop/renderer/pages/jobs.js', '.github/workflows/e2e.yml']), 'product');
  assert.equal(kindOfCommit(['src/ai/decide.py']), 'product');
  assert.equal(kindOfCommit(['extension/fill-flow.js', 'tests/test_x.py']), 'product');
  assert.equal(kindOfCommit(['desktop/e2e/suites/quality.mjs', 'desktop/e2e/lib/quality.mjs']), 'expectations');
  assert.equal(kindOfCommit(['desktop/e2e/recorded/upload-slot-1/case.json']), 'expectations');
  assert.equal(kindOfCommit(['.github/workflows/e2e.yml', 'tests/test_ship_pr.py']), 'plumbing');
  assert.equal(kindOfCommit(['desktop/e2e/test-sets.json']), 'plumbing');
  assert.equal(kindOfCommit(['tools/ship.sh']), 'plumbing');
  assert.equal(kindOfCommit(['desktop/test/card-system.test.js']), 'tests');
  assert.equal(kindOfCommit(['docs/superpowers/specs/x.md', 'desktop/docs/ui/a.png']), 'other');
  assert.equal(kindOfCommit([]), 'other');
});

test('git log text becomes commits; weeks start on Monday (UTC)', () => {
  const commits = parseLog('@@abc1234 2026-10-27\n.github/workflows/e2e.yml\ntools/ship.sh\n\n@@def5678 2026-10-25\ndesktop/main.js\n');
  assert.deepEqual(commits, [{sha: 'abc1234', day: '2026-10-27', files: ['.github/workflows/e2e.yml', 'tools/ship.sh']}, {sha: 'def5678', day: '2026-10-25', files: ['desktop/main.js']}]);
  assert.equal(weekOf('2026-10-28'), '2026-10-26');
  assert.equal(weekOf('2026-10-26'), '2026-10-26');
  assert.equal(weekOf('2026-10-25'), '2026-10-19');
});

test('rows: every kind on every day with a commit (zeros too), and each week\'s most-changed harness files', () => {
  const commits = [
    {sha: 'a', day: '2026-10-27', files: ['.github/workflows/e2e.yml']},
    {sha: 'b', day: '2026-10-27', files: ['.github/workflows/e2e.yml', 'desktop/e2e/lib/x.mjs', 'desktop/main.js']},
    {sha: 'c', day: '2026-10-27', files: ['desktop/e2e/lib/x.mjs']},
    {sha: 'd', day: '2026-10-21', files: ['desktop/e2e/suites/apply.mjs']},
  ];
  const {work, files} = workRows(commits, 2);
  assert.equal(work.length, 2 * WORK_IDS.length);
  const of = (day, kind) => work.find(row => row.day === day && row.kind === kind).commits;
  assert.equal(of('2026-10-27', 'plumbing'), 2);
  assert.equal(of('2026-10-27', 'product'), 1);
  assert.equal(of('2026-10-27', 'tests'), 0);
  assert.equal(of('2026-10-21', 'expectations'), 1);
  assert.deepEqual(files.filter(row => row.week === '2026-10-26'), [{week: '2026-10-26', file: '.github/workflows/e2e.yml', commits: 2}, {week: '2026-10-26', file: 'desktop/e2e/lib/x.mjs', commits: 2}]);
  assert.deepEqual(files.filter(row => row.week === '2026-10-19'), [{week: '2026-10-19', file: 'desktop/e2e/suites/apply.mjs', commits: 1}]);
});
