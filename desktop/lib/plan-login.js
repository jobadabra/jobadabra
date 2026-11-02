// Is the person signed in to their own CLI? The CLI's own answer, not a guess from a file or from the words of a failed AI call: `claude auth status --json` (only `loggedIn` is read) and
// `codex login status`. Free, no model call, nothing stored but the verdict. 'unknown' when the CLI is too old to have the command or does not answer: the caller then falls back to its one real AI call.
// Why (2 Nov 2026, owner, a Windows tester: Claude Code installed and found, the chooser said "Not signed in"): the verdict came from a regex over a failed haiku call's text; one real check decides now.
// Invariants: never reads or keeps the e-mail, plan or ids the CLI prints; never starts a sign-in (the person signs in on Anthropic's / OpenAI's page).
import {execFile} from 'node:child_process';

const TIMEOUT_MS = 20 * 1000;
const ARGS = {claude: ['auth', 'status', '--json'], openai: ['login', 'status']};

/** (output of the status command) -> 'signed-in' | 'signed-out' | 'unknown'. Pure: tests feed recorded outputs. */
export function readLogin(family, stdout, stderr = '', failed = false) {
  const text = `${stdout || ''}\n${stderr || ''}`;
  if (family === 'claude') {
    try { const said = JSON.parse(String(stdout || '').trim()); if (typeof said?.loggedIn === 'boolean') return said.loggedIn ? 'signed-in' : 'signed-out'; } catch { /* not JSON: an older CLI */ }
    return 'unknown';
  }
  if (/not logged in|logged out|not signed in/i.test(text)) return 'signed-out';
  if (/logged in|signed in/i.test(text) && !failed) return 'signed-in';
  return 'unknown';
}

/** Ask the CLI itself (family 'claude' | 'openai', its binary) -> 'signed-in' | 'signed-out' | 'unknown'; a CLI that fails to start or answer is 'unknown', never an error. No model call. */
export function loginStatus(family, binary, {run = execFile, env = process.env} = {}) {
  return new Promise(resolve => {
    try {
      run(binary, ARGS[family], {timeout: TIMEOUT_MS, env, windowsHide: true}, (error, stdout, stderr) => resolve(readLogin(family, stdout, stderr, !!error)));
    } catch { resolve('unknown'); }
  });
}
