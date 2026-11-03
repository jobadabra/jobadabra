// Can the person's own AI plan (Claude Code for a Claude plan, Codex for a ChatGPT plan) run on this computer, and if not, what is the ONE next step? One owner for both
// engines on Windows and Mac. facts(family, deps) reads the computer (files only, no AI call, nothing started unless the caller says what it saw: `ran`); readiness(facts) is pure and
// returns one state; the chooser (renderer/ai-plan-guide.js, pages/ai-engine.js) only draws it. The states and their words: docs/superpowers/specs/2026-11-02-claude-code-guided-setup-design.md.
// Why (2 Nov 2026, owner, a Windows tester who had only the Claude app): the screen said "Not found" and listed folders; "We should never show a raw error. We should handle it properly."
// Invariants: a state per outcome (no raw text decides what to show); a failed check keeps its raw text only for "Copy details for support"; tests give a fake computer, never the real one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {claudeBinary, claudeSearchDirs} from './apply.js';
import {SETTING, chosenFile} from './cli-files.js';
import {FAILURES, failureOf} from './plan-failure.js';
import {codexBinary, codexSearchDirs} from './ai/codex-cli.js';
import {registryPathDirs} from './win-path.js';

export const STATES = ['checking', 'ready', 'limit', 'sign-in', 'needs-git', 'app-only', 'nothing', 'elsewhere', 'broken', 'check-failed'];
export {FAILURES, failureOf};
const SETTINGS_KEY = {claude: 'claudeCode', openai: 'codex'};

// The chat app of each family, where it lives. A Store package ("Claude_*") counts; the folders are the per-user (Squirrel) and all-users installs; on the Mac an .app in /Applications or ~/Applications.
const w = path.win32.join;
export const APPS = {
  claude: {win: env => [env.LOCALAPPDATA && w(env.LOCALAPPDATA, 'AnthropicClaude'), env.LOCALAPPDATA && w(env.LOCALAPPDATA, 'Programs', 'Claude'), env.ProgramFiles && w(env.ProgramFiles, 'Claude')],
    mac: ['Claude.app'], store: /^(?:Claude_|AnthropicPBC\.Claude)/i},
  openai: {win: env => [env.LOCALAPPDATA && w(env.LOCALAPPDATA, 'Programs', 'ChatGPT'), env.ProgramFiles && w(env.ProgramFiles, 'ChatGPT')],
    mac: ['ChatGPT.app', 'Codex.app'], store: /^OpenAI\.(?:ChatGPT|Codex)/i},
};
/** Is the family's chat app (Claude Desktop, the ChatGPT app) on this computer? Looks at its known folders / Store packages / .app bundles; false when none or a folder cannot be read. */
export function desktopApp(family, {env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync, list = dir => fs.readdirSync(dir)} = {}) {
  const app = APPS[family];
  if (platform === 'win32') {
    if (app.win(env).filter(Boolean).some(folder => exists(folder))) return true;
    const packages = env.LOCALAPPDATA && w(env.LOCALAPPDATA, 'Packages');
    try { return !!packages && exists(packages) && list(packages).some(name => app.store.test(name)); } catch { return false; }
  }
  return platform === 'darwin' && app.mac.some(name => [path.posix.join('/Applications', name), path.posix.join(home, 'Applications', name)].some(file => exists(file)));
}

/**
 * What this computer has for a family ('claude' | 'openai').
 * deps (all injectable): env, platform, home, exists, list (a folder's names), registry (Windows PATH folders), settings (the saved settings: the last check and the chosen file),
 * ran: false when the CLI file was found but did not start (the caller ran `--version`); undefined when nobody ran it.
 */
export function facts(family, {env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync, list, registry = registryPathDirs, settings = {}, ran} = {}) {
  const chosen = settings[SETTING[family]] ?? chosenFile(family);
  const file = family === 'openai' ? codexBinary(env, exists, platform, chosen) : claudeBinary(env, exists, platform, registry, chosen);
  const last = settings[SETTINGS_KEY[family]] || {};
  const verified = !!last.checkedAt && 'login' in last;   // Why (2 Nov 2026, review): a record saved before the CLI's own answer existed (no `login` key) guessed from files; it is checked again, never trusted
  return {family, platform, path: file, installed: !!file && ran !== false, didNotStart: !!file && ran === false,
    chosenGone: !!chosen && !exists(chosen), desktopApp: desktopApp(family, {env, platform, home, exists, ...(list ? {list} : {})}),
    failure: verified ? last.failure || '' : '', verified,
    signedIn: verified && !!last.authenticated};   // signed in is decided by one real check (lib/plan-login.js + a tiny AI call), never by a file we read: unchecked is "checking"
}

// The one state. Order: no CLI (chosen file gone / the chat app is here / nothing) -> it did not start -> never checked (checking) -> what the last real check said -> signed in -> ready.
export function readiness(f) {
  if (!f.installed && !f.didNotStart) return f.chosenGone ? 'elsewhere' : f.desktopApp ? 'app-only' : 'nothing';
  if (f.didNotStart) return 'broken';
  if (!f.verified) return 'checking';
  if (f.failure === 'needs-git' && f.family === 'claude' && f.platform === 'win32') return 'needs-git';
  if (f.failure === 'did-not-start' || f.failure === 'failed' || f.failure === 'needs-git') return 'check-failed';
  if (f.failure === 'signed-out' || !f.signedIn) return 'sign-in';
  return f.failure === 'limit' ? 'limit' : 'ready';
}

/**
 * The text "Copy details for support" puts on the clipboard: everything a person helping would ask for, and the only place raw detail goes (where we looked, the file we found, what the last check said).
 * Never a secret: no sign-in, no key, no account file content.
 */
export function supportDetails(family, found, {env = process.env, settings = {}, version = '', state = ''} = {}) {
  const dirs = family === 'openai' ? codexSearchDirs(env, found.platform) : claudeSearchDirs(env, found.platform, registryPathDirs);
  const last = settings[SETTINGS_KEY[family]] || {};
  return ['Jobadabra support details', `engine: ${family === 'openai' ? 'Codex (ChatGPT plan)' : 'Claude Code (Claude plan)'}`, `jobadabra: ${version || 'unknown'}`, `system: ${found.platform}`,
    `state: ${state}`, `found: ${found.path || 'no'}`, `chosen file: ${settings[SETTING[family]] || 'none'}`, `chat app found: ${found.desktopApp ? 'yes' : 'no'}`,
    `last check: ${last.checkedAt || 'never'}${last.failure ? `, ${last.failure}` : ''}${last.error ? `, ${String(last.error).slice(0, 300)}` : ''}`,
    `looked in: ${[...new Set(dirs)].join('; ')}`].join('\n');
}
