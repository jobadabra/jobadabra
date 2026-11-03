// What the Connect press, the Settings card and the Changes strip ask the main process (4/6): connect (build the helper file, open it so Claude Desktop shows its own install dialog), the state, disconnect,
// the change list and Undo. Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md ("Transport and install", "Trust"). Invariants: the person presses Install in Claude's window, never this app; the state is
// "connected" only once the helper has redeemed its one-time code (a real call reached this app), until then it is "waiting"; Disconnect stops the token at once; the helper file is deleted once its code expired.
// Why (3 Nov 2026, spec Transport and install): the file is not deleted right after it is opened, because Claude Desktop reads it when the person presses Install, which can be minutes later.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildHelper, HELPER_PREFIX} from './desktop-ai-mcpb.js';
import * as pairing from './desktop-ai-pairing.js';
import * as changes from './desktop-ai-changes.js';
import {undoChange} from './desktop-ai-writes.js';

export const KEEP_MS = pairing.PAIR_MS + 60 * 1000;   // the helper file lives as long as its code can be redeemed, plus a minute

/** The state for the banner and Settings: {state: 'off' | 'waiting' | 'connected', connectedAt, lastUsedAt}. */
export function stateOf(storage, now = Date.now()) {
  const found = pairing.status(storage, now);
  return {state: found.connected ? 'connected' : found.waiting ? 'waiting' : 'off', connectedAt: found.connectedAt, lastUsedAt: found.lastUsedAt};
}

/** Removes a helper folder; never throws. -> whether it is gone. Why (code review 3 Nov 2026): on Windows a file Claude still holds open makes rmSync throw EBUSY, and a throw in the timer would end the app. */
export function removeFolder(dir, rm = fs.rmSync) {
  try { rm(dir, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}); return true; } catch { return false; }
}

/** Removes helper folders older than `olderThanMs` from `dir`: what a quit or a crash left behind with a readable one-time code in it. Run at start-up and before each Connect. */
export function sweepHelpers({dir = os.tmpdir(), now = Date.now(), olderThanMs = KEEP_MS} = {}) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => name.startsWith(HELPER_PREFIX)); } catch { return; }
  for (const name of names) {
    const folder = path.join(dir, name);
    try { if (fs.statSync(folder).mtimeMs < now - olderThanMs) removeFolder(folder); } catch { /* gone already */ }
  }
}

/**
 * Builds the helper and opens it. `openFile(file)` is Electron's shell.openPath (resolves '' when it worked); when it does not, `reveal(file)` shows the file in its folder so the person can choose it.
 * `quiet` (a test, the demo, the smoke run) builds nothing and opens nothing. -> {ok: true, opened, expires} | {ok: true, opened: false, already} | {ok: false, error}.
 * Invariants: a second Connect while waiting or connected builds nothing (a new code would make the first file's code useless); a failed build leaves no pending code and no folder;
 * the helper's folder is removed when its code has expired (timer), by the next start-up or Connect.
 */
export async function connect(storage, {version, port, openFile, reveal = () => {}, quiet = false, now = Date.now(), keepMs = KEEP_MS, build = buildHelper, tmp = os.tmpdir()}) {
  if (quiet) return {ok: true, opened: false, expires: now + pairing.PAIR_MS};
  const present = stateOf(storage, now).state;
  if (present !== 'off') return {ok: true, opened: false, already: present};
  sweepHelpers({dir: tmp, now, olderThanMs: keepMs});
  let dir = '', built;
  try { dir = fs.mkdtempSync(path.join(tmp, HELPER_PREFIX)); built = await build(storage, {version, port, now, dir}); } catch {
    pairing.disconnect(storage);
    if (dir) removeFolder(dir);
    return {ok: false, error: 'Could not prepare the helper file. Try again.'};
  }
  let opened = false;
  try { opened = !(await openFile(built.file)); } catch { opened = false; }
  if (!opened) { try { reveal(built.file); } catch { /* the words still say where to look */ } }
  setTimeout(() => removeFolder(dir), keepMs).unref();
  return {ok: true, opened, expires: built.expires};
}

/** Disconnect: the token and any unused code stop working at once. */
export const disconnect = storage => { pairing.disconnect(storage); return {ok: true}; };

/** The change list for the strip, newest first: what, before → after, when, and whether Undo can restore it. */
export const changesOf = storage => changes.list(storage).map(entry => ({id: entry.id, at: entry.at, tool: entry.tool, question: entry.question, before: entry.before, after: entry.after,
  undone: Boolean(entry.undoneAt), canUndo: !entry.undoneAt && !entry.undo, why: entry.undo || ''}));

/** Undo one change by id (the strip's button). -> {ok: true} | {ok: false, error}. */
export const undo = (storage, id) => undoChange({storage}, String(id ?? ''));

/** Fictional rows for the demo (screenshots, the demo app): what the strip looks like once the AI changed something. Never real data. */
export const demoChanges = () => [
  {id: 'demo-1', at: '2026-11-03T09:41:00.000Z', tool: 'answer_question', question: 'Notice period', before: '', after: '3 months (new)', undone: false, canUndo: true, why: ''},
  {id: 'demo-2', at: '2026-11-03T09:40:00.000Z', tool: 'answer_question', question: 'Are you authorised to work in Switzerland', before: '', after: 'Yes', undone: false, canUndo: false, why: 'It moved to Your details; change it there.'},
  {id: 'demo-3', at: '2026-11-03T09:38:00.000Z', tool: 'dismiss_question', question: 'Favourite hobby', before: '', after: 'dismissed', undone: true, canUndo: false, why: ''},
];
