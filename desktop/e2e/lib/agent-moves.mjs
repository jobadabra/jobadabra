// What a person can do in the app, as moves for the AI user agent's planner: read from the app's own ⌘K list (window.__jp.paletteCommands, one entry per action), so a new action is in the pool the day it ships.
// Job: report health
// Why (3 Nov 2026, AI user agents 3/7; spec "Which moves"): the vocabulary is the app's, not ours. A per-job entry ("Open job page: <title>") folds into one move, and anything the interaction probe may not press (a command, AI work, delete, send, sign-in, a link out) is not offered.
/* global window */
import {isSafe} from './interact.mjs';

/** The pool's one language move; the plan rewrites its label with the night's language (languageGoal). */
export const LANGUAGE_LABEL = 'Read the app in another language';
/** The app's other display languages (i18n SUPPORTED_LOCALES without en) with the names the Language dropdown shows. */
export const OTHER_LANGUAGES = Object.freeze({de: 'Deutsch', fr: 'Français', it: 'Italiano', es: 'Español', ro: 'Română', ru: 'Русский'});
const LANGUAGE_GOAL = 'Read the app in ';

/** The language move's goal text for `code` (a key of OTHER_LANGUAGES): what a person who switches the app's language does and notes. */
export const languageGoal = code => `${LANGUAGE_GOAL}${OTHER_LANGUAGES[code]}: in Settings, Overview, pick "${OTHER_LANGUAGES[code]}" in the Language dropdown (type "${OTHER_LANGUAGES[code]}" into it), then open Focus, Jobs and Settings and read each one. Note every English word, sentence, button or message you still see on them (a person's own text, company and job names stay as they are). End on Settings and leave the language as it is: the test puts the app back in English.`;
/** The pool of a night: the palette's moves plus the language move (the other OWN_MOVES are not wired to a harness step yet, so they are not offered). */
export const withLanguage = moves => moves.some(move => move.group === 'App' && move.label === LANGUAGE_LABEL) ? moves : [...moves, {group: 'App', label: LANGUAGE_LABEL}];
/** A language goal's label back to the pool's one label (a queued goal must match the pool again), any other label unchanged. */
export const poolLabel = label => String(label).startsWith(LANGUAGE_GOAL) ? LANGUAGE_LABEL : label;

/** The moves a person makes that have no ⌘K entry of their own (typing in a field, going back, reopening the app): always in the pool, so a plan can also be "edit the CV, then quit and reopen". */
export const OWN_MOVES = [
  {group: 'Profile', label: 'Edit a fact in Your details'},
  {group: 'Profile', label: 'Answer or dismiss a What we learned question'},
  {group: 'Jobs', label: 'Open a job and read its page'},
  {group: 'Jobs', label: 'Move a job to another stage'},
  {group: 'Strategy', label: 'Change the target role or place'},
  {group: 'App', label: LANGUAGE_LABEL},
  {group: 'App', label: 'Go back to the previous screen'},
  {group: 'App', label: 'Reload the window'},
  {group: 'App', label: 'Quit and reopen the app'},
];
const PER_JOB = /^(Open job page|Open documents): /;
const PER_RUN = /^Remove .+ from the queue$/;
// Why (7 Nov 2026, pz; run 42383194898 goal 4 "Read this board" could-not-finish in 3 steps): the dialog needs the address of a board behind the person's own login and its Open step leaves the app for a browser tab (never allowed), so the persona has neither the address nor a way through: a goal it can only end as could-not-finish, 1 of 4 goals that night. The board dialog itself is covered by desktop/test/unit/extension/read-board.test.js.
const NEEDS_OUTSIDE = /^Read this board$/;

/** Palette entries ([{group, label, hint, kind}]) -> unique safe moves [{group, label}], per-job entries folded, a quiet order (as listed). */
export function movesFromPalette(entries = []) {
  const seen = new Map();
  for (const {group = '', label = '', unavailable: entryUnavailable = ''} of entries) {
    const name = PER_JOB.test(label) ? label.replace(/: .*/, '') : label;
    if (entryUnavailable || !group || !name || PER_RUN.test(name) || NEEDS_OUTSIDE.test(name) || !isSafe({text: name}) || seen.has(`${group}: ${name}`)) continue;
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
  return page.evaluate(() => window.__jp.paletteCommands().map(({group, label, hint, kind, node}) => ({group, label, hint: hint || '', kind: kind || 'place',
    unavailable: node?.disabled ? 'control disabled' : node?.dataset.palette === 'tailor' && !window.__jp.shared.allJobs?.length ? 'no jobs to tailor' : ''})));
}
