// What a person can do in the app, as moves for the AI user agent's planner: read from the app's own ⌘K list (window.__jp.paletteCommands, one entry per action), so a new action is in the pool the day it ships.
// Job: report health
// Why (3 Nov 2026, AI user agents 3/7; spec "Which moves"): the vocabulary is the app's, not ours. A per-job entry ("Open job page: <title>") folds into one move, and anything the interaction probe may not press (a command, AI work, delete, send, sign-in, a link out) is not offered.
/* global window */
import {isSafe} from './interact.mjs';

/** The moves a person makes that have no ⌘K entry of their own (typing in a field, going back, reopening the app): always in the pool, so a plan can also be "edit the CV, then quit and reopen". */
export const OWN_MOVES = [
  {group: 'Profile', label: 'Edit a fact in Your details'},
  {group: 'Profile', label: 'Answer or dismiss a What we learned question'},
  {group: 'Jobs', label: 'Open a job and read its page'},
  {group: 'Jobs', label: 'Move a job to another stage'},
  {group: 'Strategy', label: 'Change the target role or place'},
  {group: 'App', label: 'Go back to the previous screen'},
  {group: 'App', label: 'Reload the window'},
  {group: 'App', label: 'Quit and reopen the app'},
];
const PER_JOB = /^(Open job page|Open documents): /;
const PER_RUN = /^Remove .+ from the queue$/;

/** Palette entries ([{group, label, hint, kind}]) -> unique safe moves [{group, label}], per-job entries folded, a quiet order (as listed). */
export function movesFromPalette(entries = []) {
  const seen = new Map();
  for (const {group = '', label = ''} of entries) {
    const name = PER_JOB.test(label) ? label.replace(/: .*/, '') : label;
    if (!group || !name || PER_RUN.test(name) || !isSafe({text: name}) || seen.has(`${group}: ${name}`)) continue;
    seen.set(`${group}: ${name}`, {group, label: name});
  }
  return [...seen.values()];
}

/** The pool: the app's own moves plus OWN_MOVES, one per group+label. OWN_MOVES skip the press-safety filter: they are made by the harness (relaunch, reload, typing), never by pressing a control. */
export const poolOf = entries => {
  const moves = movesFromPalette(entries), seen = new Set(moves.map(move => `${move.group}: ${move.label}`));
  return [...moves, ...OWN_MOVES.filter(move => !seen.has(`${move.group}: ${move.label}`))];
};

/** Reads the open app's ⌘K list. The renderer exposes it as window.__jp.paletteCommands (renderer/app.js). -> [{group, label, hint, kind}] */
export async function readPalette(page) {
  return page.evaluate(() => window.__jp.paletteCommands().map(({group, label, hint, kind}) => ({group, label, hint: hint || '', kind: kind || 'place'})));
}
