// The command line of ai-fixer.yml: one run of the fixer for ONE item (a feedback card or a Linear issue), up to a patch for a DRAFT pull request (4 Nov 2026, [hm] 3/6; spec 2026-11-03-ai-fixer-core-design.md).
//   node run.mjs cap                                   the CI side of the caps (1 at a time, 3 a day, shared with feedback-ai.yml): counts both workflows' runs today with a READ-only token
//   node run.mjs read --source S --ref R --out DIR     read the item (never printed), write DIR/brief.json, system.md, item.md, meta.json
//   node run.mjs loop --out DIR                        the agent loop on the workspace (cwd); writes DIR/pr-body.md ("title", blank, body) or DIR/verdict.md; a run without a fix leaves no edit behind
//   node run.mjs tests <file>...                       INSIDE the box: runs test files and prints their output (the box's stdout goes to the loop, never to the log)
// The log carries counts and action names only: the repository is PUBLIC and a result may quote the item. Runs from the workflow's snapshot (the AI may edit desktop/lib, never tools/).
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {noteSkipped} from '../../desktop/e2e/lib/broker-job.mjs';
import {REF, newFence} from '../feedback-ai.mjs';
import {createActs, discard} from './actions.mjs';
import {sonnetAsk} from './engine.mjs';
import {runLoop, systemFor} from './loop.mjs';
import {runTests} from './proof.mjs';
import * as feedback from './sources/feedback.mjs';
import * as linear from './sources/linear.mjs';
import {capVerdict} from './walls.mjs';
import {LIMITS, ROUND_RULES, cleanRound, roundBlocks} from './driver.mjs';

const SOURCES = {feedback, linear};
const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
/** The branch-safe handle of an item: a 16-hex feedback handle or a JOB id; anything else is refused before it can become a branch name. */
export const validRef = (source, ref) => (source === 'feedback' ? REF.test(ref) : source === 'linear' ? linear.ISSUE.test(ref) : false);

/** Runs test files in the no-network box on a FRESH copy of the workspace (the runner never reads or writes inside a box the AI's code has run in; rm does not follow links). -> {ok, output} */
export function boxRun(files, env = process.env, cwd = '.') {
  const {FBT, BOX, PYDEPS} = env;
  if (!FBT || !BOX || !PYDEPS) throw new Error('the box needs FBT, PYDEPS and BOX');
  fs.rmSync(BOX, {recursive: true, force: true});
  fs.mkdirSync(BOX, {recursive: true});
  execFileSync('cp', ['-a', `${path.resolve(cwd)}/.`, BOX]);
  const done = spawnSync('bash', [path.join(FBT, 'tools/feedback-ai-sandbox.sh'), 'node', '/fbt/tools/fixer/run.mjs', 'tests', ...files], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 8 * 60 * 1000, env});
  return {ok: done.status === 0, output: `${done.stdout || ''}${done.stderr || ''}`};
}

const emit = (env, key, value) => { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`); };

async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...args] = argv, out = flag(args, '--out'), source = flag(args, '--source'), ref = flag(args, '--ref');
  if (command === 'cap') {   // a first run only; a round's guard is round.mjs target
    // Why (4 Nov 2026, review): the round inputs belong to the follow chain; a first run that carries one is refused, so it cannot pose as a round or dodge the daily count.
    if (['ROUND', 'KIND', 'DEADLINE', 'FOLLOW_RUN', 'LAST_KEY'].some(name => env[name])) throw new Error('a first run takes no round inputs');
    emit(env, 'deadline', new Date(Date.now() + LIMITS.seconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z'));   // the hour starts at the first run and is passed on unchanged
    const day = new Date().toISOString().slice(0, 10), runs = [];
    for (const file of ['ai-fixer.yml', 'feedback-ai.yml']) {   // the daily cap of 3 is shared with Send to AI
      const answer = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${file}/runs?event=workflow_dispatch&created=%3E%3D${day}&per_page=100`, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(20000)});
      if (!answer.ok) throw new Error(`could not count today's runs (HTTP ${answer.status})`);   // fails closed
      runs.push(...(await answer.json()).workflow_runs);
    }
    // Why (4 Nov 2026, [hm] 4/7): a follow-up round is part of an item already counted; a finished round does not use the day's 3, a running one still blocks (one at a time).
    const verdict = capVerdict(runs.filter(run => !(/ round \d$/.test(run.display_title || '') && run.status === 'completed')), env.GITHUB_RUN_ID);
    if (!verdict.ok) throw new Error(verdict.why);
    console.log('cap: this run may start');
  } else if (command === 'read') {
    if (!SOURCES[source] || !validRef(source, ref)) throw new Error('--source must be feedback or linear and --ref its handle (16 hex characters, or JOB-123)');
    const task = await SOURCES[source].read(ref, {env}), fence = newFence();
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, 'brief.json'), JSON.stringify(task.brief));   // for the leak scan only
    const round = flag(args, '--round') ? cleanRound(JSON.parse(fs.readFileSync(flag(args, '--round'), 'utf8')), {pr: env.PR}) : null;   // a follow-up round: the event, as fenced data (other people's comments are not in it)
    fs.writeFileSync(path.join(out, 'system.md'), systemFor(fence, task) + (round ? `\n${ROUND_RULES}` : ''));   // instructions only: no text of the item
    fs.writeFileSync(path.join(out, 'item.md'), task.block(fence) + (round ? `\n\n${roundBlocks(round, fence)}` : ''));   // the item, as fenced data
    fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({allowedPaths: task.allowedPaths, caps: task.caps, what: task.what, round: Boolean(round)}));
    console.log(`item read: ${task.brief.text.length} characters, ${Object.keys(task.brief.files || {}).join(', ') || 'no files'}`);   // sizes and kinds only
  } else if (command === 'loop') {
    const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8')), acts = createActs({cwd: '.', allow: new RegExp(meta.allowedPaths), boxRun: files => boxRun(files, env)});
    const result = await runLoop({ask: sonnetAsk(), act: acts.act, system: fs.readFileSync(path.join(out, 'system.md'), 'utf8'), first: fs.readFileSync(path.join(out, 'item.md'), 'utf8'), caps: meta.caps, log: console.log, allowAnswer: meta.round});
    console.log(`loop: ${result.outcome}${result.stopped ? ` (${result.stopped})` : ''} after ${result.steps} turn(s), ${result.spent.calls} broker call(s), ${result.spent.input}+${result.spent.output} tokens`);
    if (result.outcome === 'fix') fs.writeFileSync(path.join(out, 'pr-body.md'), `${result.title}\n\n${result.body}\n`);
    else if (result.outcome === 'answer') { discard(); fs.writeFileSync(path.join(out, 'reply.md'), `${result.body}\n`); }   // a reply on the PR, no change pushed
    else {
      discard();
      fs.writeFileSync(path.join(out, 'verdict.md'), `${result.verdict || 'needs-human'}\nWhy: ${result.body || `the run stopped (${result.stopped.split(':')[0]}) before a fix was proven`}\n`);
      if (/^api:/.test(result.stopped)) noteSkipped({job: 'ai-fixer', why: result.stopped.slice(5).trim(), env});   // the broker (or the engine rule) refused: a warning, the alert note and skipped=true, as every CI AI job (4 Nov 2026 review: the note was never written)
    }
  } else if (command === 'tests') {
    const run = runTests(args, '.');
    process.stdout.write(run.output.slice(-8000));
    process.exitCode = run.ok ? 0 : 1;   // not process.exit: it can cut a piped stdout short
  } else throw new Error('usage: run.mjs cap|read|loop|tests (see the header)');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::ai-fixer: ${error.message}`); process.exit(1); });
