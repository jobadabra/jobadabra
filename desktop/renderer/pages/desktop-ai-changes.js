// "Changes by Claude" on Profile → What we learned (4/6): one row per change the desktop AI made, what it was before and is now, when, and Undo. A change that cannot be undone says why in the row.
// The list comes from the app (lib/desktop-ai-connect.js changesOf); Undo restores the question only while the person has not edited it since (lib/desktop-ai-writes.js undoChange).
// Invariants: the strip draws nothing while there is no change; it imports no page (the answers page hands in what to redraw after an Undo), so it adds no import cycle.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {connectWords, whenText} from '../desktop-ai-words.js';
import {plainError} from '../run-warnings.js';
import {questionsNow} from './jobs-questions.js';

/** One change row: the question, "before → after", the time and either the Undo button, "Undone", or the reason it cannot be undone. `onUndo(change, button, note)` runs the press. */
export function changeRow(change, link, onUndo, now = new Date()) {
  const row = el('div', 'qa-change');
  row.dataset.id = change.id;
  const what = el('div', 'qa-change-what');
  const dismissed = change.tool === 'dismiss_question';
  const when = whenText(change.at, now), line = [dismissed ? link.changes.dismissed : link.changes.arrow(change.before, change.after), when].filter(Boolean).join(' · ');
  what.append(el('b', '', change.question || t('pagesMisc.aQuestion')), el('span', 'muted small', line));
  if (change.why && !change.undone) what.append(el('span', 'muted small', change.why));
  const note = el('span', 'muted small');
  note.setAttribute('role', 'status');
  const side = el('div', 'qa-change-side');
  if (change.undone) side.append(el('span', 'muted small', link.changes.undone));
  else if (change.canUndo) {
    const undo = Object.assign(el('button', 'secondary small-btn', link.changes.undo), {type: 'button'});
    undo.addEventListener('click', () => onUndo(change, undo, note));
    side.append(undo);
  }
  side.append(note);
  row.append(what, side);
  return row;
}

/** The strip's node for `changes` (newest first), or null when there are none. */
export function changesStrip(changes, family, onUndo, now = new Date()) {
  if (!Array.isArray(changes) || !changes.length) return null;
  const link = connectWords(family), box = el('section', 'answer-item qa-section qa-changes');
  box.append(el('h3', '', link.changes.title), ...changes.map(change => changeRow(change, link, onUndo, now)));
  return box;
}

/**
 * Puts the strip into `into` once the list is read. `family` names the AI; `onUndone()` redraws the page after an Undo (the question is open again). Never throws: a window without the channel draws nothing.
 * -> a promise of the node it added, or null.
 */
export async function appendDesktopAiChanges(into, {family = 'claude', onUndone = () => {}} = {}) {
  const changes = await Promise.resolve().then(() => window.pilot.desktopAiChanges?.()).catch(() => null);
  const link = connectWords(family);
  const strip = changesStrip(changes, family, async (change, button, note) => {
    button.disabled = true;
    const done = await Promise.resolve().then(() => window.pilot.desktopAiUndo(change.id)).catch(() => null);
    if (done?.ok) { onUndone(); return; }
    note.textContent = done?.error ? plainError(done.error) : link.changes.undoFailed;
    button.disabled = false;
  });
  if (strip) into.append(strip);
  return strip;
}

/**
 * The answers page's one call: a slot under the banner that fills with the strip while `show` (the All view). `redraw()` reloads the page after an Undo. Kept here so the page's draw function does
 * not grow a branch (clean-code on 4/6).
 */
export function mountDesktopAiChanges(into, show, redraw) {
  if (!show) return;
  const slot = el('div', 'qa-changes-slot');
  into.append(slot);
  appendDesktopAiChanges(slot, {family: questionsNow().desktopAi?.family || 'claude', onUndone: redraw}).catch(() => {});
}
