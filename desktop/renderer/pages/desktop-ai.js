// "Let the Claude or ChatGPT desktop app answer your questions": the one press (copy the instruction, open the app) and the banner on Profile → What we learned. The words are renderer/desktop-ai-words.js,
// the detection and the launch lib/desktop-ai.js. The Focus and Jobs rows (question-entries.js) run the same press (focus-suggestions.js RUN.copy_desktop_ai) and ⌘K lists it (nav.js).
// Invariant: Not now is the Suggestions answer of KEY, kept by focus-suggestions.js answerEntry (14 days, like every card); a screen that has not seen Focus yet draws nothing (#2366: a hidden card flashed).
// This module imports no page (focus-suggestions.js hands in its three seams and the toast, as pages/notify-commands.js does), so the palette and the answers page add no import cycle (the arch gate counts them: #3011).
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {icon} from '../icons.js';
import {KEY, connectWords, whenText, words} from '../desktop-ai-words.js';
import {canConnect, pressConnect, pressDisconnect, refreshConnection, view} from './desktop-ai-connect.js';
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

const button = (label, id, tone, run) => Object.assign(el('button', `${tone} small-btn`, label), {type: 'button', id}, run ? {onclick: run} : {});

/** The banner node for What we learned's list, or null when nothing is offered. Four looks: copy only (no Connect for this AI), Connect + copy, waiting for the AI's install window, connected. */
export function desktopAiBanner() {
  if (!offered()) return null;
  const family = questionsNow().desktopAi.family, say = words(family, window.pilot.platform), link = connectWords(family);
  const state = canConnect(family) ? view.state : 'off', box = el('div', 'notice qa-banner qa-desktop-ai');
  box.dataset.family = family;
  box.dataset.state = state;
  const text = el('div', 'qa-desktop-ai-text');
  const lead = el('p', 'muted small', (canConnect(family) && view.note) || (state === 'connected' ? link.connectedLead : state === 'waiting' ? link.waiting : say.lead));
  lead.setAttribute('role', 'status');
  text.append(el('b', '', state === 'connected' ? link.connected(whenText(view.lastUsedAt)) : say.title), lead);
  const press = async (run, from) => { from.disabled = true; const done = await run(); if (done.text) lead.textContent = done.text; from.disabled = false; };
  const copy = button(say.button, 'desktop-ai-copy', canConnect(family) && state === 'off' ? 'secondary' : 'primary', null);
  copy.addEventListener('click', () => press(() => copyDesktopAi(family), copy));
  const later = button(say.notNow, 'desktop-ai-later', 'secondary', null);
  later.addEventListener('click', () => { box.remove(); seams.answerEntry({key: KEY, title: say.title}, 'Not now'); });
  const actions = el('div', 'qa-desktop-ai-actions');
  if (state === 'off' && canConnect(family)) {
    const connect = button(link.connect, 'desktop-ai-connect', 'primary', null);
    connect.addEventListener('click', () => press(() => pressConnect(family), connect));
    actions.append(connect);
  }
  if (state !== 'waiting') actions.append(copy);
  if (state !== 'off') {
    const off = button(link.disconnect, 'desktop-ai-disconnect', 'secondary', null);
    off.addEventListener('click', () => press(() => pressDisconnect(family), off));
    actions.append(off);
  }
  actions.append(later);
  const words_ = el('span', 'qa-banner-words');
  words_.append(icon('sparkle'), text);
  box.append(words_, actions);
  return box;
}

// Why (3 Nov 2026, 4/6): a banner already on the page is redrawn when the connection changes (waiting -> connected), so the person sees it turn without reopening the page.
window.addEventListener?.('desktop-ai-changed', () => {
  for (const old of document.querySelectorAll?.('.qa-desktop-ai') || []) { const fresh = desktopAiBanner(); if (fresh) old.replaceWith(fresh); else old.remove(); }
});

/** Reads the connection once the answers page is drawn (the banner then shows the right look at its next draw). */
export const readConnection = () => refreshConnection();

/** The press with its toast, for the Focus and Jobs row and ⌘K: says what was copied and whether the app opened. */
export async function pressDesktopAi() {
  const done = await copyDesktopAi(questionsNow().desktopAi?.family);
  seams.toast(done.ok ? t('pagesFieldsStatus.instructionCopied') : t('pagesFieldsStatus.nothingCopied'), done.text, done.ok ? 'good' : 'warn');
}

/**
 * Adds the palette commands (`add` is the palette's: group, label, hint, keywords, run): Connect while the Claude app is here and not connected, Disconnect while a connection exists (always listed,
 * so it can be undone from the keyboard), and the copy press while the offer is shown.
 */
export function addDesktopAiCommands(add) {
  const family = questionsNow().desktopAi?.family, link = connectWords(family || 'claude');
  const tell = (title, done) => { if (done.text) seams.toast(title, done.text, done.ok ? 'good' : 'warn'); };
  if (family === 'claude' && view.state === 'off') add(t('pagesCommon.settings'), link.connect, link.cardLine.off, 'claude connect desktop app tools mcp answer questions', async () => tell(link.connect, await pressConnect(family)));
  if (view.state !== 'off') add(t('pagesCommon.settings'), `${link.disconnect} ${link.name}`, link.cardLine[view.state], 'claude disconnect remove stop desktop app tools mcp', async () => tell(link.disconnect, await pressDisconnect('claude')));
  if (!offered()) return;
  const say = words(questionsNow().desktopAi.family);
  add(t('pagesCommon.profile'), say.title, say.button, 'claude chatgpt desktop app answer questions instruction copy paste learned ai', () => pressDesktopAi());
}
