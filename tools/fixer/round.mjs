// The two things a follow-up round does around the PR branch, kept standalone (node built-ins and driver.mjs only) because the prove and publish jobs copy few files (4 Nov 2026, [hm] 4/7).
//   node round.mjs target [--expect SHA]       the round's guard, from GitHub's own answers: the dispatch inputs only NAME things (env PR ROUND DEADLINE KIND SOURCE REF FOLLOW_RUN); writes head= and branch= to $GITHUB_OUTPUT
//   node round.mjs apply --kind K [--patch F]  a round's change on the checked-out PR branch: the scanned patch, or (kind conflict) a merge of origin/main; never a force, never a resolve
//   node round.mjs paths                       file names on stdin: all inside the folders a fix may touch (a round needs no new test; the first run's rule is check-change.mjs)
// Trust: refuses unless it runs from main's workflow, the deadline is ahead and within the hour, and the PR is still the fixer's own open draft (checkTarget).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {BRANCH, KINDS, LIMITS, checkTarget, deadlineWhy} from './driver.mjs';
import {EDITABLE} from './walls.mjs';

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const git = (...args) => execFileSync('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', ...args], {stdio: 'inherit'});

/** The round's guard. -> {head, branch}; throws with the reason (the comment says which word). `fetchImpl` and `now` (ms) are for tests. */
export async function target(env, expect = '', fetchImpl = fetch, now = Date.now()) {
  const {PR, ROUND, DEADLINE, KIND, SOURCE, REF, FOLLOW_RUN, GITHUB_REPOSITORY: repo} = env;
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('a round runs only from main\'s workflow');
  if (!/^\d{1,7}$/.test(PR || '') || !new RegExp(`^[1-${LIMITS.rounds}]$`).test(ROUND || '') || !KINDS.includes(KIND) || !/^\d{1,15}$/.test(FOLLOW_RUN || '') || !BRANCH.test(`fixer/${SOURCE}-${REF}`)) throw new Error('not a round this fixer takes');
  const late = deadlineWhy(DEADLINE, now);
  if (late) throw new Error(late === 'time' ? 'the hour is up' : late);
  const get = async path => { const answer = await fetchImpl(`https://api.github.com/repos/${repo}/${path}`, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(20000)}); if (!answer.ok) throw new Error(`could not read ${path.split('/')[0]} (HTTP ${answer.status})`); return answer.json(); };
  const found = checkTarget(await get(`pulls/${PR}`), {repo, source: SOURCE, ref: REF});
  if (!found.ok) throw new Error(found.why);
  if (expect && found.head !== expect) throw new Error('the pull request moved while the round ran');
  // Why (4 Nov 2026, review): the event data is believed only if it came from main's own follow workflow, dispatched, and in the last hour and a bit (a replayed or forged file is refused; round.json also names its PR).
  const run = await get(`actions/runs/${FOLLOW_RUN}`);
  if (run.path !== '.github/workflows/ai-fixer-follow.yml' || run.event !== 'workflow_dispatch' || run.head_branch !== 'main' || now - Date.parse(run.created_at) > (LIMITS.seconds + 300) * 1000) throw new Error('the event data is not from a recent follow run of main');
  return found;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...args] = argv, emit = (key, value) => { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`); };
  if (command === 'target') {
    const found = await target(env, flag(args, '--expect'));
    emit('head', found.head); emit('branch', found.branch);
    console.log('target: the pull request is still the fixer\'s own open draft');
  } else if (command === 'paths') {
    const bad = fs.readFileSync(0, 'utf8').split('\n').map(line => line.trim()).filter(Boolean).filter(file => !new RegExp(EDITABLE).test(file));
    if (bad.length) throw new Error(`${bad.length} file(s) outside the folders a fix may touch`);
    console.log('paths: ok');
  } else if (command === 'apply') {
    if (flag(args, '--kind') === 'conflict') {
      git('fetch', '-q', '--no-tags', 'origin', 'main');
      try { git('merge', '--no-edit', '--no-ff', 'origin/main'); } catch { try { git('merge', '--abort'); } catch { /* nothing to abort */ } throw new Error('main conflicts with the branch: a person resolves it'); }
    } else git('apply', flag(args, '--patch'));
  } else throw new Error('usage: round.mjs target|apply|paths (see the header)');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::ai-fixer round: ${String(error.message).slice(0, 200)}`); process.exit(1); });
