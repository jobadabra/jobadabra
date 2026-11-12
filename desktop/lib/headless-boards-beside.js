// Job boards read in Jobadabra's own headless Chrome beside every Find jobs press: the real seams of the step (lib/headless-boards.js) for this app: the board read's own
// short-lived browser, the engine's board queue (src.desktop headless-boards, today's share of 5), its page judge and its outcome. Registered once by the visits handlers
// (lib/search-beside.js runs it only for a person's own press). Guard: test/guards/safety/headless-boards-gate.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {createBackgroundBrowser} from './background-browser.js';
import {removeFolder} from './linkedin-browser.js';
import {boardsStep, nap} from './headless-boards.js';
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

/** How often the engine's board memory file is looked at while the press runs: one stat, nothing read. */
export const LOOK_MS = 2000;

/**
 * Watch the engine's board memory (found_boards.json) by its modification time only: the engine's queue (src.desktop headless-boards) stays the one reader
 * of what it holds. -> {mark(): take the time now, changed(signal, ended) -> true once the file was written since the last mark or change, false at Stop,
 * or when the engine's steps ended (`ended`) and a last look found nothing new}. `stat` and `sleep` are injected by tests.
 */
export function memoryWatch(file, {look = LOOK_MS, sleep = nap, stat = name => fs.promises.stat(name).then(info => info.mtimeMs).catch(() => 0)} = {}) {
  let last = null;
  const mark = async () => { last = await stat(file); };
  const changed = async (signal, ended = null) => {
    if (last === null) await mark();
    while (!signal?.aborted) {
      const over = Boolean(ended?.aborted);   // the engine is done writing: one last look, then no more waiting
      if (!over) await sleep(look, AbortSignal.any([signal, ended].filter(Boolean)));
      const seen = await stat(file);
      if (seen !== last) { last = seen; return !signal?.aborted; }
      if (over) return false;
    }
    return false;
  };
  return {mark, changed};
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
  // Why (12 Nov 2026, owner: "fresh profile, no cookies or logins"): the folder is deleted before the read (a killed app's leftover) and after it, whatever ended it
  // (Stop, the press's deadline, or since 13 Nov 2026 the engine's steps ending, `ended`, when no refused board is left to wait for).
  const step = async (signal, onLine, ended = null) => {
    const own = makeBrowser(storage);
    await removeFolder(own.folder);
    const memory = memoryWatch(path.join(storage.path('data'), 'found_boards.json'));
    await memory.mark();   // before the first ask: a board refused while it runs is seen as a change
    try {
      return await boardsStep({browser: own, start: () => own.start({port, token: extensionToken(storage)}), queue, changed: s => memory.changed(s, ended), begin, judge, outcome,
        ...(openCdp ? {openCdp} : {}), tee: onLine, signal});
    } finally {
      if (!(await own.dispose())) appLog('job-boards', 'the board read browser\'s folder was not removed; the next read removes it', {folder: FOLDER});
    }
  };
  return {step};
}
