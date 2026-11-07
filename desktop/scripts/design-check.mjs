// Measures the design system on the screens a PR changes and prints the PR's "Design system" table (owner, 7 Nov 2026, "Measured check (Recommended)"):
//   npm run design-check -- [--screens jobs,settings] [--widths 380,1100] [--base origin/main] [--parallel 4]
// For each screen, width and theme it renders the HEAD and the merge-base of --base with shot.mjs (demo data), runs the rules of design-evaluator.mjs in the window and
// marks ❌ only what the base render does not have (design-table.mjs). Exit 1 when a cell is ❌. Paste the table into the PR body; the commit it names must be the PR head.
// Screens default to all eight (shared CSS reaches every one); name the screens the change touches to be faster. Committed work only: the table names the commit.
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {designEval} from './design-evaluator.mjs';
import {renderTable} from './design-table.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(desktop, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const git = (...gitArgs) => execFileSync('git', ['-C', repo, ...gitArgs], {encoding: 'utf8'}).trim();
const screens = option('screens', 'focus,jobs,session,actions,strategy,interviews,settings,profile').split(',');
const widths = option('widths', '380,1100').split(',').map(Number);
const parallel = Number(option('parallel', 4));

if (git('status', '--porcelain', '--', 'desktop', 'extension', 'src')) { console.error('design-check: commit your changes first; the table names the commit it was measured on'); process.exit(2); }
const sha = git('rev-parse', '--short', 'HEAD');
const baseCommit = git('merge-base', option('base', 'origin/main'), 'HEAD');

// The base tree: a detached worktree of the merge-base, with the head's git-ignored node_modules and shared/ linked in (they do not change what the window draws).
const baseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'design-base-'));
const baseTree = path.join(baseRoot, 'tree');
git('worktree', 'add', '--detach', '--quiet', baseTree, baseCommit);
const cleanup = () => { try { git('worktree', 'remove', '--force', baseTree); } catch { /* already gone */ } fs.rmSync(baseRoot, {recursive: true, force: true}); };
process.on('exit', cleanup);
for (const name of ['node_modules', 'shared']) {   // a post-checkout hook may already have linked them
  const link = path.join(baseTree, 'desktop', name);
  if (!fs.existsSync(link)) fs.symlinkSync(fs.realpathSync(path.join(desktop, name)), link);
}

const measure = (root, screen, width, theme) => new Promise((resolve, reject) => {
  const child = spawn('node', ['scripts/shot.mjs', screen, '--width', String(width), '--theme', theme, '--no-picture', '--eval', designEval], {cwd: path.join(root, 'desktop')});
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('close', () => { try { resolve(JSON.parse(stdout).out); } catch { reject(new Error(`${screen} ${width} ${theme}: ${(stdout || stderr).trim().slice(0, 300)}`)); } });
});

const jobs = screens.flatMap(screen => widths.flatMap(width => ['light', 'dark'].map(theme => ({screen, width, theme}))));
const runs = [];
let next = 0;
const worker = async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    const [base, head] = await Promise.all([measure(baseTree, job.screen, job.width, job.theme), measure(repo, job.screen, job.width, job.theme)]);
    runs.push({...job, base, head});
  }
};
try { await Promise.all(Array.from({length: Math.min(parallel, jobs.length)}, worker)); }
catch (error) { console.error(`design-check: ${error.message}`); process.exit(2); }

const order = run => jobs.findIndex(job => job.screen === run.screen && job.width === run.width && job.theme === run.theme);
const {table, failed, baseline} = renderTable(runs.sort((a, b) => order(a) - order(b)), sha);
console.log(table);
console.log(`\nOn the base (${baseCommit.slice(0, 8)}), already there and allowed: ${Object.entries(baseline).map(([rule, {hits, distinct}]) => `${rule} ${hits} (${distinct})`).join(' · ')}`);
if (failed) { console.error('design-check: ❌ new violation(s) against the base render; fix them, or say in the PR why the screen must break the rule'); process.exit(1); }
