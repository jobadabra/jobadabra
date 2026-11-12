// Job boards read in Jobadabra's own headless Chrome beside every Find jobs press: the real seams of the step (lib/headless-boards.js) for this app: the board read's own
// short-lived browser, the engine's board queue (src.desktop headless-boards, today's share of 5), its page judge and its outcome. Registered once by the visits handlers
// (lib/search-beside.js runs it only for a person's own press). Guard: test/guards/safety/headless-boards-gate.test.js.
import {createBackgroundBrowser} from './background-browser.js';
import {removeFolder} from './linkedin-browser.js';
import {boardsStep} from './headless-boards.js';
import {extensionToken} from './server-env.js';
import * as pipeline from './pipeline.js';
import {engineJson} from './visits.js';
import {log as appLog} from './log.js';

/** The board read's own folder under the app folder: its profile lives and dies with one press. */
export const FOLDER = 'board-read';

/**
 * The board read's own hidden browser: its own folder (never the kept profile or LinkedIn's), a worker that never claims a queued application.
 * -> the background browser plus dispose(): close it and delete its folder; -> true when the folder is gone.
 */
export function boardReadBrowser(storage, deps = {}) {
  const browser = createBackgroundBrowser(storage, {...deps, name: FOLDER, claims: false});
  return {...browser, dispose: async () => { await browser.quit().catch(() => false); return removeFolder(browser.folder); }};
}

/** -> {step(signal, onLine)} for lib/search-beside.js. `deps` lets a test inject the browser maker, the engine run and the CDP opener. */
export function boardsSeams(storage, {makeBrowser = boardReadBrowser, run = pipeline.run, openCdp, port = Number(process.env.JOBADABRA_PORT || 47111)} = {}) {
  const queue = async () => {
    const {code, stdout} = await run(storage, ['src.desktop', 'headless-boards']).catch(() => ({code: 1, stdout: ''}));
    try { return code === 0 ? JSON.parse(String(stdout).trim().split('\n').pop()).sites || [] : []; } catch { return []; }
  };
  const begin = async item => {
    const {code, stdout} = await run(storage, ['src.desktop', 'headless-begin', item.url]).catch(() => ({code: 1, stdout: ''}));
    try { return code === 0 && JSON.parse(String(stdout).trim().split('\n').pop()).go === true; } catch { return false; }
  };
  const judge = page => engineJson(storage, 'refused-judge', {...page, html: page.html.slice(0, 60000)}, run).then(answer => (answer?.ok ? answer.state : null));   // no answer: not judged, never a guess
  const outcome = page => engineJson(storage, 'refused-outcome', page, run);
  // Why (12 Nov 2026, owner: "fresh profile, no cookies or logins"): the folder is deleted before the read (a killed app's leftover) and after it, whatever ended it.
  const step = async (signal, onLine) => {
    const own = makeBrowser(storage);
    await removeFolder(own.folder);
    try {
      return await boardsStep({browser: own, start: () => own.start({port, token: extensionToken(storage)}), queue, begin, judge, outcome, ...(openCdp ? {openCdp} : {}), tee: onLine, signal});
    } finally {
      if (!(await own.dispose())) appLog('job-boards', 'the board read browser\'s folder was not removed; the next read removes it', {folder: FOLDER});
    }
  };
  return {step};
}
