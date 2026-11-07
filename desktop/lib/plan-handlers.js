// The window's side of the readiness states (lib/plan-readiness.js): the status of each family's own CLI (Claude Code, Codex) with its state, Verify, the file picker, the official install page and "Copy details for support".
// Moved out of setup-handlers.js (2 Nov 2026) so the states have one place. Guards: test/unit/main/plan-readiness.test.js, integration/app/ai-plan-states.test.js.
// Invariants: the window never receives a raw message (the check's text stays in settings and in the support details); a file the person chose must be the real CLI (right name, starts, not the chat app);
// one anonymous counted event per state reached (family, state, system only): it follows the "Technical reports" switch like every analytics event (lib/analytics.js).
import {t} from '../i18n/native.js';
import path from 'node:path';
import * as claudeCode from './claude-code.js';
import {SETTING, rememberLogin, setChosenFile} from './cli-files.js';
import {refreshPath} from './fresh-path.js';
import {log} from './log.js';
import {facts, readiness, supportDetails} from './plan-readiness.js';
import {verifyCodex} from './ai/codex-cli.js';
import * as installer from './plan-install.js';
import {FAMILY, GIT_PAGE} from '../renderer/ai-plan-guide.js';
import {copyAndOpen, findDesktopAi, runOpen} from './desktop-ai.js';
import {stateOf} from './desktop-ai-connect.js';

const SETTINGS_KEY = {claude: 'claudeCode', openai: 'codex'};
const FILE_NAME = {claude: /^claude(?:\.exe|\.cmd)?$/i, openai: /^codex(?:\.exe|\.cmd)?$/i};
const CHAT_APP = /[\\/](?:AnthropicClaude|WindowsApps)[\\/]|\.app[\\/]/i;

/** Test seams: pc {env, home, exists, list, read, registry} is a fake computer; runVersion(file) -> '1.2.3' | null; platform; verifyFns {claude, openai}; startFn: lib/plan-install.js `start` (a test gives a fake, never the real installers). */
export function registerPlanHandlers({ipcMain, storage, dialog, getWindow, shell, clipboard = null, openApp = runOpen, track = () => {}, DEMO = false, pc = {}, runVersion = claudeCode.version, appVersion = '', platform = process.platform, verifyFns = {}, startFn = installer.start}) {
  const reached = new Set();
  for (const [family, file] of Object.entries(SETTING)) { setChosenFile(family, storage.settings()[file]); rememberLogin(family, storage.settings()[SETTINGS_KEY[family]]); }

  // The status the window draws: state + the few facts it shows. Never `error`.
  async function status(family) {
    const settings = storage.settings();
    const read = ran => facts(family, {...pc, platform, settings, ran});
    let found = read();
    if (!pc.exists && !found.path && platform === 'win32' && await refreshPath()) found = read();   // installed since the app started (Windows PATH)
    if (found.path && family === 'claude') {
      const version = await runVersion(found.path);
      found = read(!!version);
      found.version = version;
    }
    const state = readiness(found);
    if (!DEMO && !reached.has(`${family}:${state}`)) { reached.add(`${family}:${state}`); track('ai_setup_state', {family, state, os: found.platform}); }
    const last = settings[SETTINGS_KEY[family]] || {};
    // authenticated: a real check said so (Verify), and nothing since contradicts it; the chooser verifies once when a CLI looks ready but was never checked.
    return {family, state, installed: found.installed, path: found.path, version: found.version || last.version || null, authenticated: !!last.checkedAt && ['ready', 'limit'].includes(state),
      checkedAt: last.checkedAt || null, desktopApp: found.desktopApp, login: last.login || ''};
  }
  const verify = {claude: () => claudeCode.verify(storage), openai: () => verifyCodex(storage), ...verifyFns};   // verifyFns: a test's stand-ins (never the real CLI)
  const DEMO_READY = family => ({family, state: 'ready', installed: true, path: family === 'claude' ? '/usr/local/bin/claude' : '/usr/local/bin/codex', version: '2.1.0', authenticated: true, checkedAt: '2026-09-30T09:00:00Z', desktopApp: true});

  // Literal channel names (not a loop over names): test/guards/rules/ipc.test.js finds each handler by its quoted name.
  const handleStatus = family => () => (DEMO ? DEMO_READY(family) : status(family));
  const handleVerify = family => async () => {
    if (DEMO) return DEMO_READY(family);
    await verify[family]();
    return status(family);
  };
  ipcMain.handle('claudeCodeStatus', handleStatus('claude'));
  ipcMain.handle('verifyClaudeCode', handleVerify('claude'));
  ipcMain.handle('codexStatus', handleStatus('openai'));
  ipcMain.handle('verifyCodex', handleVerify('openai'));
  ipcMain.handle('planChooseFile', async (_, family) => {
    if (!FAMILY[family]) return {ok: false, reason: 'unknown'};
    const f = FAMILY[family], win = platform === 'win32';
    const picked = await dialog.showOpenDialog(getWindow(), {title: t('native.chooseProgram', {file: f.file + (win ? '.exe' : '')}), properties: ['openFile'], ...(win ? {filters: [{name: t('native.programFilter'), extensions: ['exe', 'cmd']}]} : {})});
    if (picked.canceled || !picked.filePaths?.[0]) return {ok: false, reason: 'cancelled'};
    const file = picked.filePaths[0];
    if (!FILE_NAME[family].test((platform === 'win32' ? path.win32 : path.posix).basename(file)) || CHAT_APP.test(file)) return {ok: false, reason: 'not-the-cli'};
    if (family === 'claude' && !await runVersion(file)) return {ok: false, reason: 'did-not-start'};
    storage.saveSettings({[SETTING[family]]: file, [SETTINGS_KEY[family]]: {}});   // a new file is a new CLI: the last check said nothing about it, so it is checked again (review of [cc] 1/2)
    rememberLogin(family, null);
    setChosenFile(family, file);
    return {ok: true, status: await status(family)};
  });
  // The person's own Install / Sign in (2/2): one run at a time, ended by Cancel; the window gets {ok, reason, status} and never the process's text. The end-to-end run never starts a real installer or login.
  let running = null;
  const blocked = () => ((DEMO || ((process.env.JOBADABRA_E2E || process.env.JOBADABRA_SMOKE) && startFn === installer.start)) ? {ok: false, reason: 'test'} : running ? {ok: false, reason: 'busy'} : null);
  async function run(kind, options) {
    if (blocked()) return blocked();
    let result;
    const began = Date.now();
    log('plan', `${kind} started`);   // Why (Gitar on #3018, 2 Nov 2026): a hung or failed install must be traceable from the log; kind, verdict and seconds only, never the process's text
    try {
      running = startFn(kind, {platform, env: pc.env || process.env, ...options});
      result = await running.done;
    } catch { result = {ok: false, reason: 'failed'}; } finally { running = null; }
    log('plan', `${kind} ended`, {ok: result.ok, reason: result.reason || '', seconds: Math.round((Date.now() - began) / 1000)});
    if (platform === 'win32') await refreshPath();   // the installer added its folder to this person's PATH: the app started before that
    return result;
  }
  ipcMain.handle('planInstall', async (_, which) => {
    if (!['claude', 'openai', 'git'].includes(which)) return {ok: false, reason: 'unsupported'};
    const result = await run(`install:${which}`);
    if (result.reason === 'not-found' && which === 'git') { shell.openExternal(GIT_PAGE); result.reason = 'opened-page'; }   // no winget on this PC: the official page is the way
    return {...result, status: await status(which === 'git' ? 'claude' : which)};
  });
  ipcMain.handle('planSignIn', async (_, family) => {
    if (!Object.hasOwn(FAMILY, family)) return {ok: false, reason: 'unsupported'};
    const found = facts(family, {...pc, platform, settings: storage.settings()});
    const result = found.path ? await run(`sign-in:${family}`, {binary: found.path}) : {ok: false, reason: 'unsupported'};
    if (result.ok) await verify[family]();   // the CLI's own answer decides, free when signed out (lib/plan-login.js)
    return {...result, status: await status(family)};
  });
  ipcMain.handle('planCancel', () => { running?.cancel(); return !!running; });
  ipcMain.handle('planOpenGuide', (_, which) => {
    const url = which === 'git' ? GIT_PAGE : FAMILY[which]?.page;
    if (url) shell.openExternal(url);
    return !!url;
  });
  ipcMain.handle('planSupportDetails', async (_, family) => {
    if (!FAMILY[family]) return '';
    const settings = storage.settings(), found = facts(family, {...pc, platform, settings});
    return supportDetails(family, found, {env: pc.env, settings, version: appVersion, state: readiness(found)});
  });
  // "Let the Claude or ChatGPT desktop app answer your questions" (lib/desktop-ai.js): which app this computer has, and the one press that copies the instruction and starts the app.
  // The window never gets the app's file. A test, the demo and the smoke run copy to the stand-in clipboard at most and never start an app.
  ipcMain.handle('desktopAiApp', () => { const found = findDesktopAi({...pc, platform}); return found ? {family: found.family} : null; });
  ipcMain.handle('desktopAiHelp', async () => {
    const quiet = DEMO || process.env.JOBADABRA_E2E || process.env.JOBADABRA_SMOKE;
    const result = await copyAndOpen({clipboard: clipboard || {writeText() {}}, platform, found: findDesktopAi({...pc, platform}), connected: !DEMO && stateOf(storage).state === 'connected',
      openFile: quiet ? async () => 'test' : file => shell.openPath(file), run: quiet ? async () => false : openApp});
    log('plan', 'desktop AI help', {ok: result.ok, reason: result.reason || '', family: result.family || '', opened: !!result.opened});
    return result;
  });
  return {status};
}
