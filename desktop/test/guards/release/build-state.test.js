// Which build runs (owner, 16 Oct 2026: the app ran a build older than the merged fixes and he tested old code without knowing): lib/build-state.js.
process.env.TZ = 'UTC';   // the label is local time: the same words on every machine and CI runner
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appBuild, extensionBuild, fixesLabel, labelOf, reloadLabel, restartLabel} from '../../../lib/build-state.js';

const T = '2026-10-16T14:02:00Z';
// A fake git: answers by the command it is asked.
const fakeGit = (answers = {}) => (cmd, args) => {
  const key = args.slice(2).join(' ');
  const hit = Object.entries(answers).find(([pattern]) => key.startsWith(pattern));
  if (!hit) throw new Error(`unexpected git ${key}`);
  return hit[1];
};

test('a build is told as short sha and time; no sha says nothing', () => {
  assert.equal(labelOf({commit: 'abc1234', time: T}), 'abc1234 · 16 Oct 14:02');
  assert.equal(labelOf({commit: 'abc1234', time: ''}), 'abc1234');
  assert.equal(labelOf({commit: '', time: T}), '');
});

test('the app run from source: its start commit, and how many merged desktop/extension PRs the checkout has gained since', () => {
  const run = fakeGit({'rev-parse --short=7 HEAD': 'abc1234\n', 'log -1 --format=%cI HEAD': `${T}\n`, 'rev-list --count --first-parent abc1234..HEAD -- desktop extension': '3\n'});
  const state = appBuild({repo: '/r', running: {commit: 'abc1234', time: T}, run, now: 1e6});
  assert.deepEqual({ahead: state.ahead, label: state.label}, {ahead: 3, label: 'abc1234 · 16 Oct 14:02'});
  assert.equal(appBuild({repo: '/r', running: {commit: 'abc1234', time: T}, run: fakeGit({'rev-list --count': '0\n'}), now: 2e6}).ahead, 0);
  assert.equal(appBuild({repo: '/r', running: {commit: 'abc1234', time: T}, run: () => { throw new Error('no git'); }, now: 3e6}).ahead, 0, 'git cannot count: nothing is claimed');
  assert.equal(appBuild({repo: '/r', running: {commit: '', time: ''}, run, now: 4e6}).ahead, 0, 'a build with no commit is never "behind"');
});

test('squash-merged PRs count: one commit on main per PR, merge commits too, other folders not (owner, 6 Nov 2026: no badge after 13 PRs)', () => {
  // Why (6 Nov 2026): main took PRs as squash commits from 1 Nov, and `--merges` counted 0 of the 13 desktop PRs since the owner's start, so the badge never showed. A real git history, not a fake.
  const repo = mkdtempSync(join(tmpdir(), 'build-state-')), git = (...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8'}).trim();
  const commit = (file, message) => { mkdirSync(join(repo, file, '..'), {recursive: true}); writeFileSync(join(repo, file), message); git('add', '-A'); git('commit', '-qm', message); };
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.test'); git('config', 'user.name', 't');
  commit('desktop/a.js', 'start');
  const running = {commit: git('rev-parse', '--short=7', 'HEAD'), time: T};
  git('checkout', '-qb', 'pr'); commit('extension/b.js', 'a merged PR'); git('checkout', '-q', 'main'); git('merge', '-q', '--no-ff', '-m', 'Merge pull request #1', 'pr');
  commit('desktop/c.js', 'squash PR #2'); commit('extension/d.js', 'squash PR #3'); commit('docs/e.md', 'squash PR #4, docs only');
  assert.equal(appBuild({repo, running, now: 5e6}).ahead, 3, 'one merge + two squash PRs that changed desktop/ or extension/; the docs PR is not a fix to restart for');
});

test('the extension: its commit from the version a checkout stamps, and how many fixes it lacks', () => {
  const run = fakeGit({'rev-parse HEAD': 'c'.repeat(40), 'log --reverse --format=%H %cI HEAD -- extension': `aaa1111 ${T}\nbbb2222 ${T}\nccc3333 2026-10-16T15:00:00Z\n`});
  const behind = extensionBuild({repo: '/r', version: '0.9.2', latest: '0.9.3', run});
  assert.deepEqual({behind: behind.behind, label: behind.label, latest: behind.latestLabel}, {behind: 1, label: 'bbb2222 · 16 Oct 14:02', latest: 'ccc3333 · 16 Oct 15:00'});
  assert.equal(extensionBuild({repo: '/r', version: '0.9.3', latest: '0.9.3', run}).behind, 0);
  assert.equal(extensionBuild({repo: '/r', version: '0.9', latest: '0.9.3', run}).behind, null, 'a copy that never reloaded: how many is unknown, but it IS behind');
  assert.equal(extensionBuild({repo: '/r', version: '0.9', latest: '0.9.3', run}).label, '', 'no commit is invented for a version that names none');
});

// Why (#2910, 2 Nov 2026): every extension check-in (each 30 s) walked extension/'s history twice, one walk per label, with a 20 s cache: ~1 s each on this
// repo (8,263 commits), up to git's 5 s limit each on a cold worktree, inside the request. The commits a HEAD has never change, so the walk runs once per HEAD.
const walkingGit = (state, walk) => (cmd, args) => {
  const key = args.slice(2).join(' ');
  if (key === 'rev-parse HEAD') return `${state.head}\n`;
  if (key === 'log --reverse --format=%H %cI HEAD -- extension') { state.walks += 1; return walk(); }
  throw new Error(`unexpected git ${key}`);
};
const checkIn = (repo, run) => extensionBuild({repo, version: '0.9.2', latest: '0.9.3', run});

test('the extension history is walked once per HEAD, not on every check-in', () => {
  const state = {head: 'h1', walks: 0};
  const run = walkingGit(state, () => ['aaa1111', 'bbb2222', 'ccc3333'].map(sha => `${sha.padEnd(40, '0')} ${T}`).join('\n'));
  assert.deepEqual([checkIn('/walks', run).label, checkIn('/walks', run).latestLabel], ['bbb2222 · 16 Oct 14:02', 'ccc3333 · 16 Oct 14:02']);
  assert.equal(state.walks, 1, 'two labels, two check-ins, one HEAD: one walk');
  state.head = 'h2';
  checkIn('/walks', run);
  assert.equal(state.walks, 2, 'a pull moves HEAD: the history is walked again');
});

test('a walk that fails (git hit its time limit) is not retried until HEAD moves; the labels say nothing', () => {
  const state = {head: 'h1', walks: 0};
  const run = walkingGit(state, () => { throw new Error('spawnSync git ETIMEDOUT'); });
  assert.deepEqual([checkIn('/slow', run).label, checkIn('/slow', run).latestLabel], ['', '']);
  assert.equal(state.walks, 1, 'two labels, two check-ins, one failed walk: never 2 x 5 s per check-in');
});

test('a packaged app and its extension are one build: the stamped commit, never behind', () => {
  const state = extensionBuild({repo: '/r', version: '0.9.50', latest: '0.9.50', packaged: {commit: 'def5678', time: T}, run: () => { throw new Error('no git in a package'); }});
  assert.deepEqual({behind: state.behind, label: state.label}, {behind: 0, label: 'def5678 · 16 Oct 14:02'});
});

test('the buttons say how many fixes they bring', () => {
  assert.equal(restartLabel(1), 'Restart to get 1 fix');
  assert.equal(restartLabel(4), 'Restart to get 4 fixes');
  assert.equal(reloadLabel(4), 'Reload the extension to get 4 fixes');
  assert.equal(reloadLabel(null), 'Reload the extension to get the latest fixes');
  assert.equal(fixesLabel(2), '2 fixes');
});

test('Restart counts the PRs merged into main that change the app, not their commits (owner, 29 Oct 2026: "show merged PRs in master, not other things")', () => {
  const repo = mkdtempSync(join(tmpdir(), 'build-state-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'}}).trim();
  const commit = (file, msg) => { mkdirSync(join(repo, file, '..'), {recursive: true}); writeFileSync(join(repo, file), msg); git('add', '-A'); git('commit', '-qm', msg); };
  git('init', '-q', '-b', 'main');
  commit('README.md', 'start');
  const start = git('rev-parse', '--short=7', 'HEAD');
  const pr = (name, files) => { git('checkout', '-qb', name); files.forEach((f, i) => commit(f, `${name} ${i}`)); git('checkout', '-q', 'main'); git('merge', '-q', '--no-ff', '-m', `Merge ${name}`, name); };
  pr('app-fix', ['desktop/a.js', 'desktop/b.js', 'desktop/c.js']);   // one PR, three commits
  pr('extension-fix', ['extension/x.js', 'extension/y.js']);
  pr('docs-only', ['docs/d.md']);   // changes nothing the app runs
  assert.equal(appBuild({repo, running: {commit: start, time: T}, now: 9e6}).ahead, 2, 'two merged PRs change the app; five commits, one docs PR');
});
