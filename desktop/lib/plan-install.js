// What the "Install" and "Sign in" buttons of the AI setup run (renderer/ai-plan-guide.js, `inApp`): the official installers of Claude Code and Codex, Git for Windows through winget,
// and the CLI's own sign-in. One run at a time per kind, ended by Cancel or a hang guard; the window gets only a verdict (ok, or why not), never the installer's text.
// Why (2 Nov 2026, owner, Windows testers): a person with only the chat app, or a CLI that is not signed in, is guided to a working setup from inside the app, not told to open PowerShell.
// Invariants: only the fixed official lines below run (no text from the window or the web is ever part of a command); per user, no administrator; nothing is bundled in our installer;
// Jobadabra never types or stores a password (the CLI opens its own sign-in page in the person's browser); a test must pass `spawnFn` (the real installers and logins are the person's own).
import {spawn} from 'node:child_process';
import {cleanEnv} from './ai/claude-code-cli.js';
import {codexEnv} from './ai/codex-cli.js';
import {killTree} from './kill-tree.js';

const PS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'];
/** The official install lines (code.claude.com/docs/en/setup, github.com/openai/codex README; checked 2 Nov 2026), per kind and system. */
export const INSTALLERS = {
  claude: {win32: ['powershell.exe', [...PS, 'irm https://claude.ai/install.ps1 | iex']], darwin: ['/bin/bash', ['-c', 'set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash']]},   // pipefail: a failed download ends the run (bash on empty input exits 0)
  openai: {win32: ['powershell.exe', [...PS, 'irm https://chatgpt.com/codex/install.ps1 | iex']], darwin: ['/bin/bash', ['-c', 'set -o pipefail; curl -fsSL https://chatgpt.com/codex/install.sh | sh']]},
  git: {win32: ['winget', ['install', '--id', 'Git.Git', '-e', '--source', 'winget', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements']]},
};
/** The CLI's own sign-in, started with the file the app found: it opens the provider's page in the browser and ends when the person has signed in. */
export const SIGN_IN_ARGS = {claude: ['auth', 'login'], openai: ['login']};
export const HANG_GUARD_MS = {install: 10 * 60 * 1000, 'sign-in': 5 * 60 * 1000};   // only so a stuck process cannot block the next press

/**
 * start(kind, {platform, binary, spawnFn, env, guardMs, stdio}) -> {kind, cancel(), done: Promise<{ok, reason}>}
 * kind: 'install:claude' | 'install:openai' | 'install:git' | 'sign-in:claude' | 'sign-in:openai'. binary: the CLI file (sign-in only).
 * reason (when not ok): 'unsupported' (no official line for this system), 'not-found' (the program to run is missing, e.g. no winget), 'cancelled', 'timeout', 'failed'. Never a message from the process.
 */
export function start(kind, {platform = process.platform, binary = '', spawnFn = spawn, env = process.env, guardMs, stdio = 'ignore'} = {}) {
  const [action, family] = kind.split(':');
  const line = action === 'install' ? INSTALLERS[family]?.[platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : ''] : binary && SIGN_IN_ARGS[family] ? [binary, SIGN_IN_ARGS[family]] : null;
  if (!line) return {kind, cancel() {}, done: Promise.resolve({ok: false, reason: 'unsupported'})};
  let child = null, cancelled = false, timer = null;
  const done = new Promise(resolve => {
    const finish = result => { clearTimeout(timer); resolve(result); };
    try {
      child = spawnFn(line[0], line[1], {env: family === 'openai' ? codexEnv(env) : cleanEnv(env), stdio, windowsHide: true, detached: platform !== 'win32'});
    } catch { finish({ok: false, reason: 'not-found'}); return; }
    timer = setTimeout(() => { cancelled = 'timeout'; killTree(child, {platform}); }, guardMs ?? HANG_GUARD_MS[action]);
    child.once('error', error => finish({ok: false, reason: error?.code === 'ENOENT' ? 'not-found' : 'failed'}));
    child.once('close', code => finish(cancelled ? {ok: false, reason: cancelled === 'timeout' ? 'timeout' : 'cancelled'} : {ok: code === 0, reason: code === 0 ? '' : 'failed'}));
  });
  return {kind, done, cancel() { if (child && !cancelled) { cancelled = true; killTree(child, {platform}); } }};
}
