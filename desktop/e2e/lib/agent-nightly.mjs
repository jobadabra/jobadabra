// The pure parts of the daily AI user agent workflow: how big tonight's session is (from the broker's state), which commits changed since the last one, and the files its memory commit holds.
// Job: report health
// Why (3 Nov 2026, AI user agents 7/12; mac-07: "main's Search check runs since ~2 Nov show 'AI: claude / claude-haiku-5-5 (codex ran-out)' … if Codex ran out, run a smaller session (or skip and say so) rather than queue behind other CI AI"):
// the night asks the broker once, in one tiny call, who answers; Codex answering = the full session, Claude answering because Codex ran out = half of it, a broker that refuses = no session and the reason in the summary.
import fs from 'node:fs';
import path from 'node:path';
import {isCapStop} from './agent-tier.mjs';
import {STEP_TOKENS} from './agent-steps.mjs';

export const FULL = {minutes: 20, calls: 120, steps: 100};
const HALF_FLOOR = {minutes: 5, calls: 30, steps: 30};
const MAX_MINUTES = 35;   // Why (3 Nov 2026, Gitar on 7/12): the session step has timeout-minutes 45 and the suite stops itself at its minute cap plus 5, so a repository variable above 40 would let Actions kill a working night before it writes anything.
const whole = value => (Number(value) > 0 ? Math.floor(Number(value)) : 0);

/**
 * Who answered the broker's ping: 'refused' (no answer), 'codex', 'codex-busy' (another engine answered because Codex's model was at capacity: fellBack says `overloaded`, a blip), 'codex-out' (another engine answered and Codex is named in fellBack for any other reason) or 'other' (another engine, nothing said about Codex).
 * Why (5 Nov 2026, a8's broker change via mac-32): a capacity blip at the first call must not give a half session labelled "Codex ran out".
 */
export function engineState(answer) {
  if (!answer || answer.ok === false) return 'refused';
  if (answer.engine === 'codex') return 'codex';
  const codex = (answer.fellBack || []).filter(item => item.engine === 'codex');
  if (!codex.length) return 'other';
  return codex.every(item => item.why === 'overloaded') ? 'codex-busy' : 'codex-out';
}

/**
 * Tonight's session size. `vars` are the repository variables (minutes, calls, steps; empty = FULL). -> {skip, reason, minutes, calls, steps, note}.
 * Codex out: half of each, never below the floor; a refusing broker: skip with the reason. The note is one line for the job summary.
 */
export function capsFor(state, vars = {}, detail = '') {
  const base = {minutes: Math.min(MAX_MINUTES, whole(vars.minutes) || FULL.minutes), calls: whole(vars.calls) || FULL.calls, steps: whole(vars.steps) || FULL.steps};
  if (state === 'refused') return {skip: true, reason: detail || 'the AI broker did not answer', ...base, note: `No session tonight: ${detail || 'the AI broker did not answer'}.`};
  // Why (7 Nov 2026, #3378): the steps a night may plan depend on what a step costs on the engine that answered (1k resumed on Codex, 9k on Claude), so the session gets that number and sizes its goals from it (lib/agent-steps.mjs).
  const step_tokens = state === 'codex' ? STEP_TOKENS.resumed : STEP_TOKENS.stateless;
  if (state !== 'codex-out') return {skip: false, reason: '', ...base, step_tokens, note: {codex: 'Codex answers: the full session.', 'codex-busy': 'Codex was at capacity at the first call: the full session (each call tries Codex first).'}[state] || 'Another engine answers: the full session.'};
  const half = key => Math.max(HALF_FLOOR[key], Math.floor(base[key] / 2));
  return {skip: false, reason: '', minutes: half('minutes'), calls: half('calls'), steps: half('steps'), step_tokens, note: 'Codex ran out: a half session on the engine that answers.'};
}

/** The git arguments listing the commits since the last session (`last` = its commit from the memory branch; none = the last 30), in the shape lib/agent-knowledge.mjs changedSince reads. */
export const changedLogArgs = last => ['log', '--format=@@%H%x09%s', '--name-only', last ? `${last}..HEAD` : '-30'];

/** The commit of the last session recorded on the memory branch (last.json), or '' on a first night or an unreadable file. */
export function lastSessionCommit(dir) {
  try { return String(JSON.parse(fs.readFileSync(path.join(dir, 'last.json'), 'utf8')).sha || ''); } catch { return ''; }   // Why (3 Nov 2026): a first night has no file; a damaged one only widens the changed-since list to the last 30 commits.
}

/** The files of tonight's memory commit: everything the suite left in `out` (notes/, coverage.json) plus last.json, {path: text}. */
export function memoryCommitFiles(out, {sha, today}) {
  const files = {};
  const walk = (folder, prefix) => {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      if (entry.isDirectory()) walk(path.join(folder, entry.name), `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name}`] = fs.readFileSync(path.join(folder, entry.name), 'utf8');
    }
  };
  if (fs.existsSync(out)) walk(out, '');
  files['last.json'] = `${JSON.stringify({sha, at: today}, null, 1)}\n`;
  return files;
}

/** Whether a night was worked to its end: false for a summary whose session stopped on a broker error (`api: …`), which keeps what it found but must not move the changed-since window. */
// Why (5 Nov 2026, Gitar on #3220): a night that stopped at the run's token cap ended before its later goals, exactly like a broker stop, so it keeps its notes but does not move the changed-since window or record the plan's pairs as seen; relabelling the cap stop for the report must not make it look worked.
export const nightWorked = session => Boolean(session) && !String(session.stopped || '').startsWith('api:') && !isCapStop(session.stopped);
