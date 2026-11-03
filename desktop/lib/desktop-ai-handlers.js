// What the desktop AI's read tools read, from the app that is running: the window's screen registry (the Send feedback mechanism), the last good Jobs and Strategy reads, the Profile snapshot and the support report.
// Invariants: nothing here calls the AI or Notion for a fresh read (a tool must never spend the person's credit or wait seconds); a source with nothing yet answers with a note saying what to open.
// Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md ("One mechanism, no second exporter").
import path from 'node:path';
import * as pipeline from './pipeline.js';
import * as viewCache from './view-cache.js';
import {buildLogs, profileText, PROFILE_CHARS} from './feedback-bundle.js';
import {LONG_LINE, TOOLS} from './desktop-ai-tools.js';
import {supportState} from './feedback-handlers.js';
import {aboutYou} from './about-you.js';
import {log, logFile} from './log.js';
import {setDesktopAiSources} from './desktop-ai-server.js';
import * as changes from './desktop-ai-changes.js';
import * as connection from './desktop-ai-connect.js';
import {portFrom} from './server-listen.js';
import * as writes from './desktop-ai-writes.js';
import {jobsData} from '../renderer/feedback-data.js';

/** Asks the window for a screen's data through the registry the feedback dialog uses (`window.jobadabraScreenData`, renderer/pages/feedback-screens.js). The key goes in as JSON, never as code. */
export async function windowScreen(win, key) {
  if (!win || win.isDestroyed?.()) return {screen: key, source: 'none', data: null, note: 'The Jobadabra window is not open. Open it and ask again.'};
  return (await win.webContents.executeJavaScript(`window.jobadabraScreenData ? window.jobadabraScreenData(${JSON.stringify(String(key))}) : null`)) || {screen: key, source: 'none', data: null, note: 'The app is still loading. Ask again in a moment.'};
}

// Why (code review 3 Nov 2026): aboutYou's other parts read the store (live Notion calls, seconds, and the Voice read can move a legacy section off the answers page), which a tool must never do;
// only the CV and Experience bank are files on this Mac. Details, answers and strategy reach the AI through get_screen_data, get_open_questions and get_strategy.
const FILES_ONLY = ['details', 'learned', 'strategy', 'history', 'voice'];
/** The Profile parts that are local files: the CV and its Experience bank. -> aboutYou's bundle. */
export const localProfile = (storage, {fetcher} = {}) => aboutYou(storage, 'portrait', {skip: FILES_ONLY, budget: PROFILE_CHARS, fetcher});

/** The sources object lib/desktop-ai-tools.js reads. `app`, `storage`, `getWindow` and `getPlan` are the running app's; `profileOf` and `readView` are test seams. */
export function desktopAiSources({app, storage, getWindow, getPlan, profileOf = localProfile, readView = name => viewCache.recall(storage, name)}) {
  const saved = (name, build) => {
    const cached = readView(name);
    return cached?.result ? {savedAt: cached.at, ...build(cached.result)} : {note: `Nothing saved yet. Open ${name === 'jobs' ? 'Jobs' : 'Strategy'} in the app once, then ask again.`};
  };
  // The questions the window has loaded (the drawer's own lists); null until it has read them. A write checks against these, so the AI can only touch what the person is shown. `calls` is the write cap's memory (lib/desktop-ai-changes.js).
  const writeDeps = {storage, calls: [], queue: async () => { const read = await windowScreen(getWindow?.(), 'questions'); return read.source === 'registry' ? read.data : null; }};
  return {
    screen: key => windowScreen(getWindow?.(), key),
    questions: async () => {
      const read = await windowScreen(getWindow?.(), 'questions');
      return read.source === 'registry' ? read : {...read, note: 'The app has not read the questions yet. Open the Profile once so it loads them, then ask again.'};
    },
    jobs: async () => saved('jobs', result => jobsData({rows: result.jobs || [], total: (result.jobs || []).length})),
    strategy: async () => saved('strategy', result => ({strategy: result})),
    answerQuestion: args => writes.answerQuestion(writeDeps, args),
    dismissQuestion: args => writes.dismissQuestion(writeDeps, args),
    changes: async () => ({changes: changes.list(storage).map(each => ({id: each.id, at: each.at, tool: each.tool, question: each.question, before: each.before, after: each.after, undone: Boolean(each.undoneAt), canUndo: !each.undoneAt && !each.undo}))}),
    profile: async () => profileText(await profileOf(storage), {lineChars: LONG_LINE}).text,
    support: async () => {
      const folder = logFile() ? path.dirname(logFile()) : path.join(app.getPath('userData'), 'logs');
      return buildLogs({folder, runs: pipeline.runs(storage), state: supportState({app, storage, getPlan, screen: 'desktop AI'})}).text;
    },
  };
}

/**
 * Called once from the app's handler registration. Demo mode registers no tools (every tool then says it is not available) and the Connect channels answer "off" / an empty list.
 * `ipcMain` and `shell` give the window its Connect, Disconnect, state, change list and Undo (lib/desktop-ai-connect.js); a test, the demo and the smoke run never start the file.
 */
export function registerDesktopAi({DEMO, ipcMain, shell, ...deps}) {
  setDesktopAiSources(DEMO ? null : desktopAiSources(deps));
  if (!ipcMain) return;
  const {storage, app} = deps, quiet = DEMO || Boolean(process.env.JOBADABRA_E2E || process.env.JOBADABRA_SMOKE);
  const tools = TOOLS.map(({name, description}) => ({name, description}));   // "See exactly what it can read" in the privacy note lists these, the same list the helper file's manifest has
  ipcMain.handle('desktopAiState', () => ({...(DEMO ? {state: 'off', connectedAt: '', lastUsedAt: ''} : connection.stateOf(storage)), tools}));
  if (!quiet) { connection.sweepHelpers(); setTimeout(() => connection.sweepHelpers(), connection.KEEP_MS + 1000).unref(); }   // a quit or crash left a folder with a readable one-time code: gone at start-up, or once that code has expired
  // Why (Gitar on #3090): each of these has a lasting effect (a file with a one-time code, a revoked token, a restored answer), so each leaves one line with identities and outcomes only, never the code, the path or a question's words.
  ipcMain.handle('desktopAiConnect', async () => {
    const done = await connection.connect(storage, {version: app.getVersion(), port: portFrom(), openFile: file => shell.openPath(file), reveal: file => shell.showItemInFolder(file), quiet});
    log('desktop-ai', 'connect pressed', {ok: done.ok, opened: Boolean(done.opened), already: done.already || '', quiet});
    return done;
  });
  ipcMain.handle('desktopAiDisconnect', () => {
    const done = DEMO ? {ok: true} : connection.disconnect(storage);
    log('desktop-ai', 'disconnect pressed', {ok: done.ok, demo: Boolean(DEMO)});
    return done;
  });
  ipcMain.handle('desktopAiChanges', () => (DEMO ? connection.demoChanges() : connection.changesOf(storage)));
  ipcMain.handle('desktopAiUndo', async (_, id) => {
    const done = DEMO ? {ok: false, error: 'Demo mode: nothing to undo.'} : await connection.undo(storage, id);
    log('desktop-ai', 'undo pressed', {id: String(id ?? ''), ok: done.ok, error: done.ok ? '' : String(done.error || '').slice(0, 80)});
    return done;
  });
}
