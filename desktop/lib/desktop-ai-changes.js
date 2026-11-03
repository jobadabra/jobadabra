// What the desktop AI changed in this app: the one writer of `settings.desktopAiChanges` (a list the person reads and undoes from, 4/6) and the write-rate cap.
// Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md ("Trust" 2, 3 and 5). Invariants: every accepted write is recorded here before its tool answers; an entry never holds a secret (values are
// cut and the caller passes answers only); the list is capped; an entry is never removed, only marked undone, so the person can see what happened.
import crypto from 'node:crypto';

const SETTING = 'desktopAiChanges';
export const MAX_ENTRIES = 200, VALUE_CHARS = 500, WRITES = 60, WINDOW_MS = 10 * 60 * 1000;
const all = storage => (Array.isArray(storage.settings()[SETTING]) ? storage.settings()[SETTING] : []);
const cut = value => String(value ?? '').slice(0, VALUE_CHARS);

/** Records an accepted change. entry: {tool, target (the queue key), question, before, after, undo ('' = Undo can restore it, else the plain reason it cannot)}. -> the stored entry {id, at, client, …}. */
export function record(storage, entry, now = new Date()) {
  const stored = {id: crypto.randomBytes(6).toString('hex'), at: now.toISOString(), client: 'Claude Desktop', tool: entry.tool, target: String(entry.target || ''), question: cut(entry.question), before: cut(entry.before), after: cut(entry.after), undo: entry.undo || ''};
  storage.saveSettings({[SETTING]: [stored, ...all(storage)].slice(0, MAX_ENTRIES)});
  return stored;
}

/** The changes, newest first. */
export const list = storage => all(storage);

/** One change by id, or null. */
export const find = (storage, id) => all(storage).find(each => each.id === id) || null;

/** Marks a change undone (kept in the list). -> true when it was there and not yet undone. */
export function markUndone(storage, id, now = new Date()) {
  const entries = all(storage);
  const at = entries.findIndex(each => each.id === id && !each.undoneAt);
  if (at < 0) return false;
  storage.saveSettings({[SETTING]: entries.map((each, index) => (index === at ? {...each, undoneAt: now.toISOString()} : each))});
  return true;
}

/**
 * The cap on write calls (accepted or refused, so a looping AI that keeps retrying a refused value is stopped too): at most WRITES in WINDOW_MS per connection. `calls` is the connection's own
 * array of timestamps (the caller keeps it in memory: a restart is a new connection). -> {ok: true} | {ok: false, error}.
 */
export function allowWrite(calls, now = Date.now()) {
  while (calls.length && now - calls[0] >= WINDOW_MS) calls.shift();
  if (calls.length >= WRITES) return {ok: false, error: 'Slow down: that is a lot of changes in a short time. Ask the person to review what you changed in Jobadabra, then continue.'};
  calls.push(now);
  return {ok: true};
}
