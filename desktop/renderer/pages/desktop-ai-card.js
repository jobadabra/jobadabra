// Settings → Connections → Claude desktop app (4/6): the state (not connected, waiting for install, connected), the last use, Connect and Disconnect. Shown when the Claude app is on this computer or a
// connection exists. The words are renderer/desktop-ai-words.js, the state and presses pages/desktop-ai-connect.js (one view for the banner, this card and ⌘K).
// Invariant: the card reads the same view as the banner; "Connected" appears only when the main process says the helper reached the app.
// Why (3 Nov 2026, 4/6): the state pill is drawn here, not by settings.js stateLine, because settings.js leads back to connections.js (an import cycle the architecture check counts).
import {$, show} from './core.js';
import {connectWords, whenText} from '../desktop-ai-words.js';
import {canConnect, pressConnect, pressDisconnect, refreshConnection, view} from './desktop-ai-connect.js';
import {icon} from '../icons.js';

let family = '';   // 'claude' when the Claude app is here; '' until the window asked

/** Draws the card from the shared view. */
export function drawDesktopAiCard() {
  const card = $('setting-desktop-ai');
  if (!card) return;
  const name = family || 'claude', say = connectWords(name), here = canConnect(name) && (family === 'claude' || view.state !== 'off');
  show(card, here);
  if (!here) return;
  $('dai-title').textContent = say.cardTitle;
  $('dai-line').textContent = say.cardLine[view.state];
  const text = view.state === 'connected' && view.lastUsedAt ? `Connected · Last used ${whenText(view.lastUsedAt)}` : say.states[view.state];
  const pill = document.createElement('span');
  pill.id = 'dai-status';
  pill.className = `service-state${view.state === 'connected' ? ' is-on' : ''}`;
  pill.title = text;
  pill.append(icon(view.state === 'connected' ? 'check-circle' : 'info'));
  const label = document.createElement('span');
  label.className = 'service-state-text';
  label.textContent = text;
  pill.append(label);
  $('dai-status').replaceWith(pill);
  show($('dai-connect'), view.state === 'off');
  $('dai-connect').textContent = say.connect;
  show($('dai-disconnect'), view.state !== 'off');
  $('dai-disconnect').textContent = say.disconnect;
  $('dai-message').textContent = view.note;
}

/** Reads the app (is the Claude app here, what is the connection) and draws; also on every change of the shared view. */
export async function showDesktopAiCard() {
  const found = await Promise.resolve().then(() => window.pilot.desktopAiApp?.()).catch(() => null);
  family = found?.family === 'claude' ? 'claude' : '';
  await refreshConnection();
  drawDesktopAiCard();
}

/** Binds the two buttons once, at start-up. */
export function bindDesktopAiCard() {
  window.addEventListener('desktop-ai-changed', drawDesktopAiCard);
  const press = async (button, run) => { button.disabled = true; const done = await run(); if (done.text) $('dai-message').textContent = done.text; button.disabled = false; drawDesktopAiCard(); };
  $('dai-connect')?.addEventListener('click', () => press($('dai-connect'), () => pressConnect('claude')));
  $('dai-disconnect')?.addEventListener('click', () => press($('dai-disconnect'), () => pressDisconnect('claude')));
}
