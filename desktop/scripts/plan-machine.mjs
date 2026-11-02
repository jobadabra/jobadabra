// One machine-setup check of the AI chooser's readiness (lib/plan-readiness.js) on a REAL computer, for the daily fresh-install smoke (.github/workflows/fresh-install-smoke.yml, job "AI setup").
//   node scripts/plan-machine.mjs <claude|openai> <nothing|app-only|install>
//   nothing    the runner has neither the chat app nor the CLI: the state must be `nothing`.
//   app-only   a marker of the chat app is planted (the folder or .app its installer makes), the state must be `app-only`, the marker is removed again.
//   install    the app's own installer (lib/plan-install.js, the official line) runs for real; the CLI must then be FOUND by the app's finders and, signed out as every fresh runner is,
//              the CLI's own answer must give `sign-in` (the real `claude auth status --json` / `codex login status`).
// Exit 0 when the state is the expected one; 1 with the state, the folders looked in and what the installer said otherwise. Never signs in, never reads ~/.claude.json, never calls an AI.
// Why (2 Nov 2026, owner: "yes. Let's do"): the Windows testers' setups (only the Claude app / nothing / CLI not signed in) were never tried on a real Windows or Mac machine before a person hit them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {version} from '../lib/claude-code.js';
import {facts, readiness, supportDetails} from '../lib/plan-readiness.js';
import {loginStatus} from '../lib/plan-login.js';
import {start} from '../lib/plan-install.js';

const [family, wanted] = process.argv.slice(2);
if (!['claude', 'openai'].includes(family) || !['nothing', 'app-only', 'install'].includes(wanted)) { console.error('usage: plan-machine.mjs <claude|openai> <nothing|app-only|install>'); process.exit(2); }
const win = process.platform === 'win32', home = os.homedir();
// The marker of each chat app: what its own installer leaves (lib/plan-readiness.js desktopApp looks for exactly these).
const MARKER = {
  claude: win ? path.join(process.env.LOCALAPPDATA, 'AnthropicClaude') : path.join(home, 'Applications', 'Claude.app'),
  openai: win ? path.join(process.env.LOCALAPPDATA, 'Programs', 'ChatGPT') : path.join(home, 'Applications', 'ChatGPT.app'),
};
const read = ran => facts(family, {settings: {}, ran});
const say = (state, extra = {}) => console.log(`plan-machine: ${JSON.stringify({os: process.platform, family, wanted, state, ...extra})}`);
const EXPECT = {nothing: 'nothing', 'app-only': 'app-only', install: 'sign-in'};
const ROW = `${process.platform === 'win32' ? 'windows' : 'macos'} ${family} ${wanted}`;   // the first red line names the row and its step (a8, 2 Nov 2026)
const fail = (state, extra = '') => { console.error(`RED ${ROW}: expected ${EXPECT[wanted]}, got ${state}`); say(state); console.error(`${supportDetails(family, read(), {env: process.env, settings: {}, version: 'ci', state})}\n${extra}`); process.exit(1); };

if (wanted === 'nothing') {
  const state = readiness(read());
  if (state !== 'nothing') fail(state);
  say(state);
} else if (wanted === 'app-only') {
  fs.mkdirSync(MARKER[family], {recursive: true});
  try {
    const state = readiness(read());
    if (state !== 'app-only') fail(state, `marker: ${MARKER[family]}`);
    say(state);
  } finally { fs.rmSync(MARKER[family], {recursive: true, force: true}); }
} else {
  // Why (2 Nov 2026, first dispatch): a person's PowerShell finds Windows' own tar first; this job's bash step put Git's GNU tar first and the Codex installer died ("tar: Cannot connect to C: resolve failed"). The row tries the person's PATH, not the runner's.
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';   // a plain copy of process.env is case-sensitive; Windows calls it "Path"
  const env = win ? {...process.env, [pathKey]: [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), process.env[pathKey]].join(path.delimiter)} : process.env;
  const run = start(`install:${family}`, {stdio: 'inherit', env});
  const result = await run.done;
  if (!result.ok) fail('installer-' + result.reason, 'the official installer did not finish on this runner');
  let found = read();   // a fresh process: Windows PATH comes from the registry (lib/fresh-path.js), the Mac's from the installers' folders
  if (!found.path) fail(readiness(found), 'the installer finished but the app\'s finders do not see the CLI: add its folder to the search list');
  const login = await loginStatus(family, found.path);
  if (login !== 'signed-out') fail('login-' + login, 'the CLI\'s own answer on a fresh runner must be signed-out');   // `unknown` would also read as sign-in: the row proves the real answer
  const ran = family === 'claude' ? !!await version(found.path) : true;
  found = facts(family, {settings: {[family === 'claude' ? 'claudeCode' : 'codex']: {checkedAt: new Date().toISOString(), login, authenticated: login === 'signed-in', failure: login === 'signed-out' ? 'signed-out' : ''}}, ran});
  const state = readiness(found);
  say(state, {path: path.basename(found.path), login, started: ran});
  if (state !== 'sign-in') fail(state, `the CLI answered login=${login}`);
}
