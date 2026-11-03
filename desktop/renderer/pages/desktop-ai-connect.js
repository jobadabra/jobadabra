// Connect Claude (4/6): the window's copy of the connection state (off, waiting for Claude's install window, connected), the privacy note shown once before the first Connect, and the Connect and
// Disconnect presses. The banner (pages/desktop-ai.js), Settings → Connections (pages/desktop-ai-card.js), the Changes strip and ⌘K all read this one view. The words are renderer/desktop-ai-words.js,
// the main process side lib/desktop-ai-connect.js. Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md.
// Invariants: this module imports no page (so the banner, the card and the palette add no import cycle); the window never sees the token or the helper's file; polling runs only while the state is
// "waiting" and stops by itself when the state leaves it; "connected" is only what the main process says (the helper reached the app), never a guess from the press.
import {$} from './core.js';
import {connectWords} from '../desktop-ai-words.js';

export const view = {loaded: false, state: 'off', lastUsedAt: '', tools: [], note: ''};   // note: what the last press said, kept while the state is waiting
const POLL_MS = 3000;
let timer = null;
const seenKey = family => `desktopAiPrivacy:${family}`;
const seen = family => { try { return localStorage.getItem(seenKey(family)) === '1'; } catch { return false; } };
const remember = family => { try { localStorage.setItem(seenKey(family), '1'); } catch { /* a blocked store only means the note shows again */ } };

function watch() {
  if (view.state === 'waiting' && !timer) timer = setInterval(() => { refreshConnection(); }, POLL_MS);
  if (view.state !== 'waiting' && timer) { clearInterval(timer); timer = null; }
}

/** Reads the state from the app; tells the pages (banner, card, strip) when it changed. -> the view. */
export async function refreshConnection() {
  const found = await Promise.resolve().then(() => window.pilot.desktopAiState?.()).catch(() => null);
  if (!found?.state) return view;
  const changed = !view.loaded || found.state !== view.state || (found.lastUsedAt || '') !== view.lastUsedAt;
  Object.assign(view, {loaded: true, state: found.state, lastUsedAt: found.lastUsedAt || '', tools: found.tools || view.tools});
  if (view.state !== 'waiting') view.note = '';
  watch();
  if (changed) window.dispatchEvent?.(new Event('desktop-ai-changed'));
  return view;
}

/** Whether Connect is offered for this AI: only Claude until ChatGPT's tunnel (6/6) exists. */
export const canConnect = family => family === 'claude';

/** The first sentence of a tool's description, cut: the descriptions are written for the AI and run long; the person needs what the tool is for. */
export const brief = text => { const first = String(text || '').split(/(?<=\.)\s/)[0]; return first.length > 110 ? `${first.slice(0, 107)}…` : first; };

// The privacy note, once per AI, before its first Connect. Resolves true when Connect was pressed in it.
function confirmPrivacy(family) {
  if (seen(family)) return Promise.resolve(true);
  const dialog = $('desktop-ai-privacy-dialog'), say = connectWords(family).privacy;
  if (!dialog || dialog.open) return Promise.resolve(false);
  $('desktop-ai-privacy-title').textContent = say.title;
  $('desktop-ai-privacy-text').textContent = say.text;
  $('desktop-ai-privacy-yes').textContent = say.connect;
  $('desktop-ai-privacy-no').textContent = say.cancel;
  $('desktop-ai-privacy-tools').textContent = say.tools;
  const list = $('desktop-ai-privacy-list');
  list.replaceChildren(...view.tools.map(tool => Object.assign(document.createElement('li'), {textContent: `${tool.name}: ${brief(tool.description)}`})));
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => { const yes = dialog.returnValue === 'default'; if (yes) remember(family); resolve(yes); }, {once: true});
    dialog.showModal();
  });
}

/**
 * The Connect press: the note first (once), then the helper file opens in the AI's app. -> {ok, text}: what to tell the person ('' when they chose Not now or it is already connecting).
 * Why (code review 3 Nov 2026): a second Connect makes a new code and the first file's code stops working, so a press while waiting or connected does nothing.
 */
export async function pressConnect(family = 'claude') {
  const say = connectWords(family);
  if (!canConnect(family)) return {ok: false, text: ''};
  await refreshConnection();   // the note lists the tools the app reported
  if (view.state !== 'off') return {ok: false, text: ''};
  if (!(await confirmPrivacy(family))) return {ok: false, text: ''};
  const done = await Promise.resolve().then(() => window.pilot.desktopAiConnect()).catch(() => null);
  if (!done?.ok) return {ok: false, text: say.failed};
  const text = done.already ? '' : done.opened ? say.waiting : say.notOpened;
  await refreshConnection();
  tell(text);
  return {ok: true, text};
}

// What the last press said, kept until the next refresh that finds the state not waiting; set after the refresh so the redraw it causes shows it (the state may not have changed: a quiet run stays off).
function tell(text) {
  view.note = text;
  window.dispatchEvent?.(new Event('desktop-ai-changed'));
}

/** The Disconnect press: the token stops working at once. -> {ok, text}. */
export async function pressDisconnect(family = 'claude') {
  const say = connectWords(family);
  const done = await Promise.resolve().then(() => window.pilot.desktopAiDisconnect()).catch(() => null);
  await refreshConnection();
  const text = done?.ok ? say.disconnected : say.failed;
  tell(text);
  return {ok: Boolean(done?.ok), text};
}
