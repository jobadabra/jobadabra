// "Let the Claude or ChatGPT desktop app answer your questions": the one press (copy the instruction, open the app) and the banner on Profile → What we learned. The words are renderer/desktop-ai-words.js,
// the detection and the launch lib/desktop-ai.js. The Focus and Jobs rows (question-entries.js) run the same press (focus-suggestions.js RUN.copy_desktop_ai) and ⌘K lists it (nav.js).
// Invariant: Not now is the Suggestions answer of KEY, kept by focus-suggestions.js answerEntry (14 days, like every card); a screen that has not seen Focus yet draws nothing (#2366: a hidden card flashed).
// This module imports no page (focus-suggestions.js hands in its three seams and the toast, as pages/notify-commands.js does), so the palette and the answers page add no import cycle (the arch gate counts them: #3011).
import {el} from '../components.js';
import {icon} from '../icons.js';
import {KEY, words} from '../desktop-ai-words.js';
import {questionsNow} from './jobs-questions.js';

let seams = {answerEntry: () => {}, answered: () => true, focusIsRead: () => false, toast: () => {}};
/** Focus's Suggestions section hands in what it owns: its Not now (`answerEntry`, `answered`), whether it has been read, and the toast. */
export const setDesktopAiSeams = value => { seams = {...seams, ...value}; };

/** The press: copies the instruction, opens the app. -> {ok, text}: what to tell the person (copied and opened, copied only, or nothing found). */
export async function copyDesktopAi(family) {
  const done = await window.pilot.desktopAiHelp().catch(() => null);
  const say = words(done?.family || family, window.pilot.platform);
  if (done?.ok) return {ok: true, text: say.done(!!done.opened)};
  return {ok: false, text: done?.reason === 'none' ? say.gone : say.failed};   // only a missing app is "gone"; a refused clipboard or a failed call is "try again" (Gitar on #3023)
}

/** Puts the banner into a page when it is offered (kept here so a long page function does not grow: clean-code on #3023). */
export function appendDesktopAiOffer(into) {
  const offer = desktopAiBanner();
  if (offer) into.append(offer);
}

/** Whether the offer shows now: the app is here, a learned question is open, Focus has been read, and it was not set aside (Not now). */
export const offered = () => Boolean(questionsNow().desktopAi?.family) && questionsNow().learned.length > 0 && seams.focusIsRead() && !seams.answered(KEY);

/** The banner node for What we learned's list, or null when nothing is offered. */
export function desktopAiBanner() {
  if (!offered()) return null;
  const family = questionsNow().desktopAi.family, say = words(family, window.pilot.platform);
  const box = el('div', 'notice qa-banner qa-desktop-ai');
  box.dataset.family = family;
  const text = el('div', 'qa-desktop-ai-text');
  const lead = el('p', 'muted small', say.lead);
  lead.setAttribute('role', 'status');
  text.append(el('b', '', say.title), lead);
  const copy = Object.assign(el('button', 'primary small-btn', say.button), {type: 'button', id: 'desktop-ai-copy'});
  const later = Object.assign(el('button', 'secondary small-btn', say.notNow), {type: 'button', id: 'desktop-ai-later'});
  copy.addEventListener('click', async () => { copy.disabled = true; lead.textContent = (await copyDesktopAi(family)).text; copy.disabled = false; });
  later.addEventListener('click', () => { box.remove(); seams.answerEntry({key: KEY, title: say.title}, 'Not now'); });
  const actions = el('div', 'qa-desktop-ai-actions');
  actions.append(copy, later);
  const words_ = el('span', 'qa-banner-words');
  words_.append(icon('sparkle'), text);
  box.append(words_, actions);
  return box;
}

/** The press with its toast, for the Focus and Jobs row and ⌘K: says what was copied and whether the app opened. */
export async function pressDesktopAi() {
  const done = await copyDesktopAi(questionsNow().desktopAi?.family);
  seams.toast(done.ok ? 'Instruction copied ✓' : 'Nothing copied', done.text, done.ok ? 'good' : 'warn');
}

/** Adds the palette command while the offer is shown (`add` is the palette's: group, label, hint, keywords, run). */
export function addDesktopAiCommands(add) {
  if (!offered()) return;
  const say = words(questionsNow().desktopAi.family);
  add('Profile', say.title, say.button, 'claude chatgpt desktop app answer questions instruction copy paste learned ai', () => pressDesktopAi());
}
