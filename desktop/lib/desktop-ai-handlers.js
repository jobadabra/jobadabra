// What the desktop AI's read tools read, from the app that is running: the window's screen registry (the Send feedback mechanism), the last good Jobs and Strategy reads, the Profile snapshot and the support report.
// Invariants: nothing here calls the AI or Notion for a fresh read (a tool must never spend the person's credit or wait seconds); a source with nothing yet answers with a note saying what to open.
// Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md ("One mechanism, no second exporter").
import path from 'node:path';
import * as pipeline from './pipeline.js';
import * as viewCache from './view-cache.js';
import {buildLogs, profileText, PROFILE_CHARS} from './feedback-bundle.js';
import {LONG_LINE} from './desktop-ai-tools.js';
import {supportState} from './feedback-handlers.js';
import {aboutYou} from './about-you.js';
import {logFile} from './log.js';
import {setDesktopAiSources} from './desktop-ai-server.js';
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
  return {
    screen: key => windowScreen(getWindow?.(), key),
    questions: async () => {
      const read = await windowScreen(getWindow?.(), 'profile:answers');
      return read.source === 'registry' ? read : {...read, note: 'Open Profile → What we learned once so the app loads the questions, then ask again.'};
    },
    jobs: async () => saved('jobs', result => jobsData({rows: result.jobs || [], total: (result.jobs || []).length})),
    strategy: async () => saved('strategy', result => ({strategy: result})),
    profile: async () => profileText(await profileOf(storage), {lineChars: LONG_LINE}).text,
    support: async () => {
      const folder = logFile() ? path.dirname(logFile()) : path.join(app.getPath('userData'), 'logs');
      return buildLogs({folder, runs: pipeline.runs(storage), state: supportState({app, storage, getPlan, screen: 'desktop AI'})}).text;
    },
  };
}

/** Called once from the app's handler registration. Demo mode registers nothing: every tool then says it is not available. */
export function registerDesktopAi({DEMO, ...deps}) {
  setDesktopAiSources(DEMO ? null : desktopAiSources(deps));
}
