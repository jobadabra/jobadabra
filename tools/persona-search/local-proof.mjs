// One command proves a Find jobs change on this Mac in about 2.5 minutes a search and prints one table (sa for the owner, 11 Nov 2026: "Make the feedback loow to be local and to be few mins. 3 mins.").
//   node tools/persona-search/local-proof.mjs <person 1-18> [--ref <git ref>]... [--runs N] [--same-draw] [--together] [--fresh-draft]
//   --ref: the code to search with, any number (two = before | after side by side): a checkout folder (`.` = this one, the default; or a session's worktree path) searches as it is, edits too;
//          Any other ref gets its own detached worktree under <os temp>/jp-local-proof/trees/<sha>, made once and never edited (the repo's post-checkout hook links node_modules).
//   --runs N: N searches a side (default 1), round by round (side 1, side 2, then again), all with the same saved plan; the table then says per side each run, the median and the range,
//          and one verdict: gain shown, loss shown, inside the noise or not enough runs (the rule: local-proof-table.mjs verdict()). A run whose AI stopped (the plan's limit, Claude Code missing or
//          signed out: the run's own words) is NOT COUNTED and the rounds left are not started (it is not retried).
//   --same-draw: both sides get the same job-board draw: side 1's code records one extra search (not counted) on a tape (run.mjs --tape, src/search_tape.py), and every counted run
//          replays its own copy of that tape at the recorded pace (--wait-scale 1): the same web pages, AI answers and time-budget decisions; an AI question the tape lacks (a change that asks
//          something else) is asked live, and a page the tape lacks fails as unreachable (nothing new is read). The table says per run whether the boards proposed match the recording
//          ("draw not shared" when they do not), how many AI answers were live and how many pages were not on the tape. Off by default.
//   --together: the refs search at the same time instead of one after the other (to measure whether two local searches move the 3-minute clock); at most 2 refs, so at most 2 searches at once.
//   --fresh-draft: make the person's saved search plan again.
// What it cuts (a full local run, search-check.mjs, is 5-12 min): the CV (gate.py cv) and the strategy draft (one AI call of ~1 min) are made ONCE per person and kept in
// <os temp>/jp-local-proof/people/p<n>/ (outside the repo and the app's folder; kept until macOS clears its temp folder), so every run searches for exactly the same thing
// (a change to the strategy draft itself is therefore NOT tested unless --fresh-draft remakes the plan with the first ref); no judge, no second press. What is left is the press itself
// (its own 3-minute clock, desktop/lib/search-steps.js) plus the engine's start-up. The search runs through run.mjs: a throwaway install under the OS temp folder, the Claude plan
// via `claude -p` ($0), API keys removed from the environment, never the person's app folder, Keychain, Notion or Telegram; telemetry and pool sharing off.
// The model is Haiku (JOBADABRA_MODEL_OVERRIDE, as the CI Search check) unless the environment names another. A run whose log says the AI stopped is marked NOT COUNTED, with why.
// Claude Code runs from a private copy made at the start (<os temp>/jp-local-proof/pinbin/<stamp>-<pid>/claude, first on PATH), so its own update mid-search cannot remove it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {cleanEnv} from './search-check.mjs';
import {realClaude} from '../../desktop/e2e/lib/real-claude.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2), person = Number(args[0]);
const refs = args.flatMap((arg, i) => (arg === '--ref' ? [args[i + 1]] : []));
const runs = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : 1;
// Why (12 Nov 2026, brief sa-pane-ns): at most 2 local searches at once on this Mac, so --together pairs two refs and no more.
if (!(person >= 1 && person <= 18) || refs.some(ref => !ref || ref.startsWith('--')) || !(Number.isInteger(runs) && runs >= 1) || (args.includes('--together') && refs.length > 2)) {
  console.error('usage: node tools/persona-search/local-proof.mjs <person 1-18> [--ref <git ref>]... [--runs N] [--same-draw] [--together (at most 2 refs)] [--fresh-draft]');
  process.exit(2);
}
const name = `p${person}`, work = path.join(os.tmpdir(), 'jp-local-proof'), home = path.join(work, 'people', name);
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const env = {...cleanEnv(process.env), JOBADABRA_NO_DOTENV: '1', JOBADABRA_AI_CALL_LOG: '1', JOBADABRA_STAGE_LOG: '1',
  JOBADABRA_MODEL_OVERRIDE: process.env.JOBADABRA_MODEL_OVERRIDE || 'claude-haiku-5-5'};
const git = (...a) => execFileSync('git', a, {cwd: ROOT, encoding: 'utf8'}).trim();

/** Puts a private copy of the Claude Code install first on env.PATH; says so, or why the runs use the install itself (none found, or a copy that does not start). */
function pinClaude() {
  // Why (gp, 12 Nov 2026, sa: "every remaining run of yours uses a pinned copy"): Claude Code updates itself and its binary is gone for about a second; a p10 run at
  // second 28 and one at second 88 lost every AI step ("AI stopped: Claude Code is not installed"), and both were counted as the plan's limit. One copy per proof
  // (its own folder, never one another proof is running from), as the fictional-candidate-runs skill's pinbin.
  const real = realClaude(env);
  if (!real) return console.log('Claude Code: no install found on PATH; the runs will say so');
  // The folder is named <stamp>-<pid>: unique per proof (two can start in the same second) and its owner is known the moment it exists.
  const dir = path.join(work, 'pinbin', `${stamp}-${process.pid}`), pin = path.join(dir, 'claude');
  // A copy is ~320 MB: this proof's goes when it ends (Ctrl-C and a kill too), and one a proof left behind goes once that proof's process is gone
  // (only ESRCH says gone; EPERM is a live process of another user). A folder with no pid in its name goes after 10 minutes.
  for (const old of fs.existsSync(path.dirname(dir)) ? fs.readdirSync(path.dirname(dir)) : []) {
    const at = path.join(path.dirname(dir), old), owner = Number(/-(\d+)$/.exec(old)?.[1] || 0);
    let gone;
    if (owner) {
      try { process.kill(owner, 0); gone = false; } catch (error) { gone = error.code === 'ESRCH'; }
    } else {
      try { gone = Date.now() - fs.statSync(at).mtimeMs > 600000; } catch { gone = false; }
    }
    if (gone) fs.rmSync(at, {recursive: true, force: true});
  }
  process.on('exit', () => fs.rmSync(dir, {recursive: true, force: true}));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(signal === 'SIGINT' ? 130 : 143));
  try {
    fs.mkdirSync(dir, {recursive: true});
    fs.copyFileSync(fs.realpathSync(real), pin);
    fs.chmodSync(pin, 0o755);
    const version = execFileSync(pin, ['--version'], {encoding: 'utf8', timeout: 30000, env: {...env, PATH: `${dir}${path.delimiter}${env.PATH}`}}).trim();
    env.PATH = `${dir}${path.delimiter}${env.PATH}`;
    env.JOBADABRA_CLAUDE_BIN = pin;   // the engine's find_binary reads it before PATH (Gitar on #3897)
    console.log(`Claude Code: a private copy for these runs (${version}): ${pin}`);
  } catch (error) {
    fs.rmSync(dir, {recursive: true, force: true});
    console.log(`Claude Code: the install itself (${real}); a copy did not start (${String(error.message).split('\n')[0].slice(0, 80)}), so an update mid-search can still stop a run`);
  }
}

/** The folder whose code searches: this checkout for `.`, else a detached worktree of the ref's commit, made once (staged: desktop/shared is generated). */
function tree(ref) {
  const folder = ref === '.' ? ROOT : fs.existsSync(path.join(ref, 'tools', 'persona-search', 'run.mjs')) ? path.resolve(ref) : null;   // a checkout as it is (a session's worktree, edited between runs)
  if (folder) {
    const at = (...a) => execFileSync('git', a, {cwd: folder, encoding: 'utf8'}).trim();
    if (!fs.existsSync(path.join(folder, 'desktop', 'shared', 'app-core', 'ai.js'))) execFileSync('node', ['scripts/stage.mjs', '--files-only'], {cwd: path.join(folder, 'desktop'), stdio: 'ignore'});
    return {label: `${path.basename(folder)} (${at('rev-parse', '--short', 'HEAD')}${at('status', '--porcelain', '--untracked-files=no', '--', 'src', 'desktop/lib') ? ' + edits' : ''})`, dir: folder};
  }
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`), dir = path.join(work, 'trees', sha.slice(0, 12));
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), {recursive: true});
    git('worktree', 'add', '--detach', dir, sha);
  }
  if (!fs.existsSync(path.join(dir, 'desktop', 'shared', 'app-core', 'ai.js'))) execFileSync('node', ['scripts/stage.mjs', '--files-only'], {cwd: path.join(dir, 'desktop'), stdio: 'ignore'});
  return {label: `${ref} (${sha.slice(0, 8)})`, dir};
}

/** run.mjs in `dir` for this person -> resolves {code, seconds} when it ends; its output goes to <out>/run.out. */
function press(dir, out, extra) {
  fs.mkdirSync(path.join(out, name), {recursive: true});
  fs.copyFileSync(path.join(home, 'cv.pdf'), path.join(out, name, 'cv.pdf'));
  const started = Date.now(), log = fs.openSync(path.join(out, 'run.out'), 'w');
  const child = spawn('node', [path.join(dir, 'tools', 'persona-search', 'run.mjs'), name, out, '--fresh', '--tag', `lp-${path.basename(out)}`, ...extra], {cwd: dir, env, stdio: ['ignore', log, log]});
  return new Promise(resolve => child.on('close', code => resolve({code, seconds: Math.round((Date.now() - started) / 1000)})));
}

// The person's CV and search plan, once.
fs.mkdirSync(home, {recursive: true});
if (!fs.existsSync(path.join(home, 'cv.pdf'))) {
  const made = path.join(work, `cv-${stamp}`);
  execFileSync('python3', ['tools/persona-search/gate.py', 'cv', String(person), made], {cwd: ROOT, env, stdio: 'ignore'});
  fs.copyFileSync(path.join(made, 'draw', 'cv.pdf'), path.join(home, 'cv.pdf'));
}
pinClaude();
const trees = (refs.length ? refs : ['.']).map(tree);
if (args.includes('--fresh-draft') || !fs.existsSync(path.join(home, 'draft.json'))) {
  console.log(`${name}: making the saved search plan once (one AI call, ~1 min) with ${trees[0].label}`);
  const out = path.join(work, 'runs', `${stamp}-draft`), {code} = await press(trees[0].dir, out, ['--presses', '0']);
  if (code !== 0 || !fs.existsSync(path.join(out, name, 'draft.json'))) { console.error(`no search plan: see ${path.join(out, 'run.out')}`); process.exit(1); }
  fs.copyFileSync(path.join(out, name, 'draft.json'), path.join(home, 'draft.json'));
}

console.log(`${name}: search plan saved ${fs.statSync(path.join(home, 'draft.json')).mtime.toISOString().slice(0, 16)}Z (a change to the strategy draft is NOT tested; --fresh-draft remakes it)`);
console.log(`${name}: ${trees.length} search${trees.length > 1 ? `es, ${args.includes('--together') ? 'at the same time' : 'one after the other'}` : ''}${runs > 1 ? `, ${runs} rounds` : ''}, ~2.5 min each, on the Claude plan (${env.JOBADABRA_MODEL_OVERRIDE})`);
const {table, noise, read, notCounted} = await import('./local-proof-table.mjs');
const plan = ['--presses', '1', '--draft', path.join(home, 'draft.json')];
let draw = null;   // --same-draw: the recording's folder, its tape and its read
if (args.includes('--same-draw')) {
  const out = path.join(work, 'runs', `${stamp}-draw`), tape = path.join(out, 'tape');
  console.log(`  the shared draw: ${trees[0].label} records one search (not counted): ${out}`);
  const r = await press(trees[0].dir, out, [...plan, '--tape', tape, '--record']);
  draw = {out, tape, read: read({...r, out, name, label: 'recording'})};
  // Why (Gitar on #3848): a crashed or failed recording leaves a cut tape, and every replay would then miss what came after the cut; it is refused by the rule counted runs use
  const bad = r.code !== 0 ? `exit ${r.code}` : notCounted(draw.read);
  if (bad) { console.error(`no shared draw: the recording does not count (${bad}); see ${path.join(out, 'run.out')}`); process.exit(1); }
}
const go = (t, i, round) => {
  const out = path.join(work, 'runs', `${stamp}-${runs > 1 ? `r${round}-` : ''}${i + 1}`);
  console.log(`  ${runs > 1 ? `round ${round}, ` : ''}${i + 1}. ${t.label}: ${out}`);
  // Why (12 Nov 2026, sa-pane-ns): a replay keeps each answer it asked live on the tape it reads, so every run replays its own copy and no run answers another's question
  if (draw) fs.cpSync(draw.tape, path.join(out, 'tape'), {recursive: true});
  const extra = draw ? [...plan, '--tape', path.join(out, 'tape'), '--replay', '--wait-scale', '1'] : plan;
  return press(t.dir, out, extra).then(r => ({...r, out, label: t.label, side: i, name, draw: draw?.read}));
};
const ran = [];
for (let round = 1; round <= runs; round++) {
  if (args.includes('--together')) ran.push(...await Promise.all(trees.map((t, i) => go(t, i, round))));
  else for (const [i, t] of trees.entries()) ran.push(await go(t, i, round));
  const limit = ran.map(read).find(x => x.limit);
  if (limit && round < runs) { console.log(`  the AI stopped in ${limit.label} (${limit.limit.replace(/^\[\d+s\] (?:AI stopped: )?/, '').slice(0, 100)}): rounds ${round + 1}-${runs} are not started`); break; }
}

if (runs === 1) console.log(`\n${table(ran)}`);
else console.log(`\n${noise(trees.map((t, i) => ({label: t.label, runs: ran.filter(r => r.side === i)})), name, draw)}`);
