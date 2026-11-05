// The daily AI user agent workflow's two steps (.github/workflows/ai-user-agents.yml): `prepare` (ask the broker who answers, size the session, check out the memory branch, list what changed) and `publish` (push the night's notes).
// Job: report health
// Why (3 Nov 2026, AI user agents 7/12): the workflow only starts suite=agent with these answers; the decisions are in lib/agent-nightly.mjs (tested) and the memory push is lib/agent-memory.mjs pushMemory. A night that did not run
// (the broker refused, the suite died before its summary) pushes nothing, so the changed-since window never moves past a night that was not worked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {askBroker} from './lib/broker-client.mjs';
import {MODELS} from './lib/agent-ask.mjs';
import {BRANCH, pushMemory} from './lib/agent-memory.mjs';
import {actorEngineOf} from './lib/agent-tier.mjs';
import {capsFor, changedLogArgs, engineState, lastSessionCommit, memoryCommitFiles, nightWorked} from './lib/agent-nightly.mjs';

const TEMP = process.env.RUNNER_TEMP || os.tmpdir();
const MEMORY_DIR = path.join(TEMP, 'agent-memory');
const git = (args, cwd) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
const output = (key, value) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value).replace(/\s*\n\s*/g, ' ')}\n`); console.log(`${key}=${value}`); };
const today = () => new Date().toISOString().slice(0, 10);

/** A checkout of the memory branch at MEMORY_DIR (a git worktree of this clone, so it shares the job's credentials); on a first night a detached worktree of HEAD that pushMemory turns into the orphan branch. Returns whether the branch existed. */
function checkoutMemory() {
  if (fs.existsSync(MEMORY_DIR)) return fs.existsSync(path.join(MEMORY_DIR, '.git'));
  const exists = Boolean(git(['ls-remote', '--heads', 'origin', BRANCH]).trim());
  if (exists) git(['fetch', '--quiet', 'origin', BRANCH]);
  git(['worktree', 'add', '--quiet', '--detach', MEMORY_DIR, exists ? `origin/${BRANCH}` : 'HEAD']);
  return exists;
}

async function prepare() {
  const engine = actorEngineOf({requested: process.env.AGENT_ENGINE, claudeOn: process.env.AGENT_CLAUDE_ON});   // a night on Claude alone checks that Claude answers, not Codex
  const answer = await askBroker({model: MODELS.small, max_tokens: 16, messages: [{role: 'user', content: 'Reply with the word ok.'}], ...(engine ? {engine, only: true} : {})});
  const caps = capsFor(engineState(answer), {minutes: process.env.AI_USER_AGENT_MINUTES, calls: process.env.AI_USER_AGENT_CALLS, steps: process.env.AI_USER_AGENT_STEPS}, answer.ok === false ? `${answer.status}: ${answer.detail}` : '');
  for (const [key, value] of Object.entries(caps)) output(key, value);
  if (caps.skip) return;
  const existed = checkoutMemory();
  const last = existed ? lastSessionCommit(MEMORY_DIR) : '';
  let log;
  try { log = git(changedLogArgs(last)); } catch { log = git(changedLogArgs('')); }   // Why (3 Nov 2026): a last session commit this clone does not have (rewritten history) only widens the list to the last 30 commits.
  fs.writeFileSync(path.join(TEMP, 'agent-changed.log'), log);
  output('memory_dir', existed ? MEMORY_DIR : '');
  output('changed_log', path.join(TEMP, 'agent-changed.log'));
}

function publish() {
  const artifacts = process.env.E2E_ARTIFACTS || '';
  if (!artifacts || !fs.existsSync(path.join(artifacts, 'agent-session.json'))) { console.log('No session summary: nothing is pushed to the memory branch.'); return; }
  let session = null;
  try { session = JSON.parse(fs.readFileSync(path.join(artifacts, 'agent-session.json'), 'utf8')); } catch (error) { console.log(`The session summary is unreadable (${error.message}): nothing is pushed.`); return; }
  if (!nightWorked(session)) { console.log(`The night stopped early (${session.stopped}): the notes stay in the artifact, nothing is pushed to the memory branch.`); return; }
  checkoutMemory();
  const files = memoryCommitFiles(path.join(artifacts, 'agent-memory-out'), {sha: git(['rev-parse', 'HEAD']).trim(), today: today()});
  const result = pushMemory({dir: MEMORY_DIR, files, git: args => git(args, MEMORY_DIR), message: `Night ${today()}: notes and coverage`});
  console.log(result.pushed ? `Pushed ${Object.keys(files).length} files to ${BRANCH}.` : `Nothing changed: ${BRANCH} is as it was.`);
}

const mode = process.argv[2];
if (mode === 'prepare') await prepare();
else if (mode === 'publish') publish();
else { console.error('usage: node agent-nightly.mjs prepare|publish'); process.exit(2); }
