// The Claude or ChatGPT desktop app on this computer, found by the same folders as the AI setup's detection (lib/plan-readiness.js APPS), and the one press that copies the instruction and opens it.
// Used by the handlers desktopAiApp / desktopAiHelp (lib/plan-handlers.js). Invariants: it only reads folders, copies text and starts the app's own file; no URL scheme, no typing into the app, no
// click in it. When the app's file cannot be found (a Store package has none) nothing is claimed to be opened: the person is told to open it.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {execFile} from 'node:child_process';
import {APPS, desktopApp} from './plan-readiness.js';
import {instruction} from '../renderer/desktop-ai-words.js';

const ORDER = ['claude', 'openai'];   // both apps on one PC: Claude first (the owner named it first)
const EXE = {claude: 'claude.exe', openai: 'ChatGPT.exe'};

/**
 * The app's file to start: the .app bundle on the Mac, the .exe inside its folder (or inside its newest app-x.y.z folder, as an installer that keeps versions does) on Windows; '' when none is there.
 * Reads files only (exists / list are injectable).
 */
export function desktopAppFile(family, {env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync, list = dir => fs.readdirSync(dir)} = {}) {
  const app = APPS[family];
  if (platform === 'darwin') return app.mac.flatMap(name => ['/Applications', path.posix.join(home, 'Applications')].map(dir => path.posix.join(dir, name))).find(file => exists(file)) || '';
  if (platform !== 'win32') return '';
  const w = path.win32.join;
  for (const folder of app.win(env).filter(Boolean)) {
    let versions = [];
    try { versions = exists(folder) ? list(folder).filter(name => /^app-/i.test(name)).sort().reverse().map(name => w(folder, name)) : []; } catch { versions = []; }
    const found = [folder, ...versions].map(dir => w(dir, EXE[family])).find(file => exists(file));
    if (found) return found;
  }
  return '';
}

/** Which desktop AI app this computer has, for the banner: {family, file} (file '' when only a Store package or an unreadable folder shows it) or null. Claude first. */
export function findDesktopAi(deps = {}) {
  const {env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync, list} = deps;
  const family = ORDER.find(name => desktopApp(name, {env, platform, home, exists, ...(list ? {list} : {})}));
  return family ? {family, file: desktopAppFile(family, {env, platform, home, exists, ...(list ? {list} : {})})} : null;
}

/** The Mac's `open <app>`: resolves true when it started, false on any error. Windows starts the file through Electron's shell.openPath instead. */
export const runOpen = (command, args) => new Promise(resolve => execFile(command, args, error => resolve(!error)));

/**
 * Copies the instruction and starts the app. `clipboard.writeText`, `openFile(file)` (Electron's shell.openPath: resolves to '' when it worked) and `run(cmd, args)` (the Mac's open) are injected.
 * -> {ok: true, opened} or {ok: false, reason: 'none'}; `opened` is true only when the start call said so.
 */
export async function copyAndOpen({clipboard, openFile, run, found = findDesktopAi(), platform = process.platform}) {
  if (!found) return {ok: false, reason: 'none'};
  clipboard.writeText(instruction());
  let opened = false;
  try {
    if (!found.file) opened = false;
    else if (platform === 'darwin') opened = !!(await run('open', [found.file]));
    else opened = !(await openFile(found.file));
  } catch { opened = false; }
  return {ok: true, family: found.family, opened};
}
