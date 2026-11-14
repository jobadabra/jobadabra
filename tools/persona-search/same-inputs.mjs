// By-hand same-inputs pair: one fictional person, two code versions search at the same second on this Mac and read the same pages and get the same AI answers (src/same_inputs.py).
//   node tools/persona-search/same-inputs.mjs <profile id> --a <ref|folder> --b <ref|folder> [--no-share] [--no-ai] [--presses 2] [--keep]
//   A = before, B = after (main twice is an A/A: the noise). A ref gets its own throwaway worktree under <os temp>/jp-same-inputs/trees/<sha> (made once); a folder is used as it is and must already hold
//   src/same_inputs.py (a worktree made after this tool landed does). A ref from before it landed gets the module copied into its throwaway tree only, never into a checkout you work in.
//   --no-share: nothing shared (the baseline), --no-ai: pages only, --presses 2: a second search on the same install (the link answers are cached), --keep: leave <work>/shared and the stores.
// Then python3 tools/persona-search/same_inputs_report.py <work> <profile id> prints LISTED / READ / RIGHT (both / only A / only B) with the blind judge run once over both lists.
// Safety: fictional people only (search-profiles.json); the Claude plan only (every API key and base URL removed); EURES and LinkedIn guest off; the engine's data folder is a throwaway
// under the OS temp folder (run.mjs) and src/same_inputs.py refuses any other; the shared folder is deleted at the end. How to read it: skill same-inputs-search-pair.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {cleanEnv} from './search-check.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2), id = args[0];
const option = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/persona-search/search-profiles.json'), 'utf8')).profiles;
const [refA, refB, presses] = [option('--a'), option('--b'), option('--presses') || '1'];
if (!profiles.some(p => p.id === id) || !refA || !refB || !['1', '2'].includes(presses)) {
  console.error(`usage: node tools/persona-search/same-inputs.mjs <${profiles.map(p => p.id).join('|')}> --a <ref|folder> --b <ref|folder> [--no-share] [--no-ai] [--presses 1|2] [--keep]`);
  process.exit(2);
}
const tmp = fs.realpathSync(os.tmpdir()), base = path.join(tmp, 'jp-same-inputs');
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15), work = path.join(base, `${id}-${stamp}-${process.pid}`);
const share = !args.includes('--no-share'), keep = args.includes('--keep');
for (const name of ['JOBADABRA_DATA_DIR', 'JOBADABRA_CONFIG_DIR']) {   // the owner's app folder is never a search's: only a throwaway under the temp folder may be named
  const named = process.env[name];
  let real = null;
  try { real = named ? fs.realpathSync(named) : null; } catch { real = path.resolve(named); }   // a folder that does not exist yet is judged by its path
  if (named && (path.relative(tmp, real).startsWith('..') || path.isAbsolute(path.relative(tmp, real)))) { console.error(`${name} names a folder outside ${tmp}: refused`); process.exit(2); }
}
const env = {...cleanEnv(process.env), JOBADABRA_NO_DOTENV: '1', JOBADABRA_AI_CALL_LOG: '1', JOBADABRA_STAGE_LOG: '1',
  ...(share ? {JOBADABRA_TAPE_SHARED: path.join(work, 'shared'), ...(args.includes('--no-ai') ? {} : {JOBADABRA_TAPE_SHARED_AI: '1'})} : {})};
for (const name of Object.keys(env)) if (/(_API_KEY|_KEY)$/.test(name) || ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'JOBADABRA_EURES', 'JOBADABRA_AI_ENGINE'].includes(name) || /^JOBADABRA_LINKEDIN/.test(name)) delete env[name];   // every LinkedIn switch off too: CI and tools never read LinkedIn

const git = (...a) => execFileSync('git', a, {cwd: ROOT, encoding: 'utf8'}).trim();
const HOOK = "\nimport os as _os_si  # noqa: E402\nif _os_si.getenv('JOBADABRA_TAPE_SHARED'):\n    from . import same_inputs as _same_inputs  # noqa: E402\n    _same_inputs.install()\n";

/** The folder whose code searches: a folder as it is (it must hold src/same_inputs.py), else a throwaway worktree of the ref, made once, with the module added when the ref predates it. */
function tree(ref) {
  if (fs.existsSync(path.join(ref, 'tools', 'persona-search', 'run.mjs'))) {
    if (!fs.existsSync(path.join(ref, 'src', 'same_inputs.py'))) { console.error(`${ref} has no src/same_inputs.py: pass a ref (the tool makes its own tree) or a checkout made after it landed`); process.exit(2); }
    return path.resolve(ref);
  }
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`), dir = path.join(base, 'trees', sha.slice(0, 12));
  if (!fs.existsSync(path.join(dir, '.git'))) { fs.mkdirSync(path.dirname(dir), {recursive: true}); git('worktree', 'add', '--detach', dir, sha); }
  if (!fs.readFileSync(path.join(dir, 'src', '__init__.py'), 'utf8').includes('same_inputs')) {   // the module and its hook go in together, once
    fs.copyFileSync(path.join(ROOT, 'src', 'same_inputs.py'), path.join(dir, 'src', 'same_inputs.py'));
    fs.appendFileSync(path.join(dir, 'src', '__init__.py'), HOOK);
  }
  if (!fs.existsSync(path.join(dir, 'desktop', 'shared', 'app-core', 'ai.js'))) execFileSync('node', ['scripts/stage.mjs', '--files-only'], {cwd: path.join(dir, 'desktop'), stdio: 'ignore'});
  return dir;
}

/** run.mjs for the person in `dir`, output under `out`; resolves {code, seconds}. */
function run(dir, out, tag, extra, runEnv = env) {
  const log = fs.openSync(path.join(out, 'run.out'), 'w'), began = Date.now();
  const child = spawn('node', [path.join(dir, 'tools/persona-search/run.mjs'), 'draw', out, '--tag', tag, ...extra], {cwd: dir, env: runEnv, stdio: ['ignore', log, log]});
  return new Promise(resolve => child.on('close', code => resolve({code, seconds: Math.round((Date.now() - began) / 1000)})));
}
const prepare = out => {
  fs.mkdirSync(path.join(out, 'draw'), {recursive: true});
  for (const file of ['cv.pdf', 'cv.md', 'draw.json']) fs.copyFileSync(path.join(work, 'cv/draw', file), path.join(out, 'draw', file));
};

const dirs = {a: tree(refA), b: tree(refB)};
if (dirs.a === dirs.b) { console.error('A and B are the same folder: the sides could not tell their own asks from the other\'s; pass two checkouts'); process.exit(2); }
fs.mkdirSync(work, {recursive: true});
if (!keep) process.on('exit', () => fs.rmSync(path.join(work, 'shared'), {recursive: true, force: true}));
execFileSync('python3', ['tools/persona-search/profiles.py', 'cv', id, path.join(work, 'cv')], {cwd: ROOT, env, stdio: 'ignore'});
const draft = path.join(work, 'draft'); fs.mkdirSync(draft, {recursive: true}); prepare(draft);
console.log(`${id}: the one strategy draft and board proposal, made with A (~1 min)`);
const unshared = Object.fromEntries(Object.entries(env).filter(([name]) => !/^JOBADABRA_TAPE_SHARED/.test(name)));   // the draft's own asks must not seed the shared folder: A would then refetch what B is served (#4267 review)
const drafted = await run(dirs.a, draft, 'si-draft', ['--presses', '0', '--fresh', '--propose'], unshared);
if (drafted.code !== 0 || !fs.existsSync(path.join(draft, 'draw/draft.json'))) { console.error(`no draft: see ${draft}/run.out`); process.exit(1); }
const install = side => path.join(tmp, `jp-persona-draw-si-${side}`);
fs.cpSync(install('draft'), path.join(work, 'draftdata'), {recursive: true});   // the sides' starting install: a replay of one side starts from it
for (const side of ['a', 'b']) {
  fs.rmSync(install(side), {recursive: true, force: true}); fs.cpSync(install('draft'), install(side), {recursive: true});
  for (const file of ['install_id', 'site_tokens.json']) fs.rmSync(path.join(install(side), 'data', file), {force: true});   // run.mjs lends each side its own pooled install id and tokens, never one shared id (#4266 review)
}
console.log(`${id}: A and B search at the same second (pages ${share ? 'shared' : 'not shared'}), ${new Date().toISOString().slice(11, 19)}Z`);
const searched = await Promise.all(['a', 'b'].map(side => {
  const out = path.join(work, side); fs.mkdirSync(out, {recursive: true}); prepare(out);
  return run(dirs[side], out, `si-${side}`, [...(presses === '2' ? ['--presses', '2'] : ['--presses', '1', '--first-only']), '--draft', path.join(draft, 'draw/draft.json')]);
}));
const ids = ['a', 'b'].map(side => { try { return fs.readFileSync(path.join(install(side), 'data', 'install_id'), 'utf8').trim(); } catch { return ''; } });
if (ids[0] && ids[0] === ids[1]) console.error(`${id}: A and B drew the same install id (${ids[0]}), 1 pair in 20: they share one index budget, so run the pair again`);
for (const [i, side] of ['a', 'b'].entries()) {
  const out = path.join(work, side);
  execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, "tools/persona-search"); import gate; gate.extract(sys.argv[1], sys.argv[2], include_urls=True)', path.join(install(side), 'data/jobs.sqlite'), path.join(out, 'jobs.json')], {cwd: ROOT, stdio: 'inherit'});
  if (keep) fs.cpSync(path.join(install(side), 'data'), path.join(out, 'store'), {recursive: true});
  console.log(`${id}: side ${side.toUpperCase()}: exit ${searched[i].code}, ${searched[i].seconds} s, ${out}`);
}
for (const name of share && fs.existsSync(path.join(work, 'shared')) ? fs.readdirSync(path.join(work, 'shared')).filter(f => f.startsWith('log-')) : []) {   // what each side's shared layer did, before the folder goes: a wait that ran to its limit breaks "the same seconds"
  const lines = fs.readFileSync(path.join(work, 'shared', name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  console.log(`${id}: ${name}: ${lines.filter(l => l.kind === 'live_after_wait').length} asks went live after waiting for the other side, ${lines.filter(l => l.kind === 'exit').map(l => l.url).pop() || 'no exit line (the run was cut)'}`);
}
console.log(`RESULT ${work}`);
