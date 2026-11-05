// Always on's Test → "Check notifications" pop-up (owner, 5 Nov 2026: "open a popup … enable/check/confirm the notifications right away, from that page", "reuse the card from Settings → Notifications … without duplicating it").
// Why: the pop-up holds no copy of the choice. The one card of Settings → Notifications (#setting-notify, pages/notify-settings.js) is moved into the dialog while it is open and back when it closes, so
// every switch, the address, the confirm link and Telegram work exactly as there, saved at once. The card is refreshed through the `notify-refresh` event (notify-settings.js listens).
import {$} from './core.js';
import {NOTIFY_LEAD, proposeLead} from '../always-on-test-words.js';

let testAgain = () => {}, home = null;

/** Opens the pop-up; `onTestAgain` runs the Test again when "Test again" is pressed (the pop-up closes first). `propose`: the test could not reach the person (a sentence = the site's own reason, else true), so the lead says why and to change a way. */
export function openNotifyCheck(onTestAgain, {propose = false} = {}) {
  const card = $('setting-notify'), dialog = $('aon-notify-dialog');
  if (!card || !dialog || dialog.open) return;
  testAgain = onTestAgain;
  if (card.parentElement !== $('aon-notify-slot')) home = card.parentElement;   // never the slot itself, if a close event was late
  $('aon-notify-lead').textContent = propose ? proposeLead(typeof propose === 'string' ? propose : '') : NOTIFY_LEAD;
  $('aon-notify-slot').append(card);
  window.dispatchEvent(new Event('notify-refresh'));
  dialog.showModal();
}

/** Wire the pop-up once (its markup is in index.html). */
export function bindNotifyCheck() {
  const dialog = $('aon-notify-dialog');
  if (!dialog || dialog.dataset.bound) return;
  dialog.dataset.bound = '1';
  dialog.addEventListener('close', () => { const card = $('setting-notify'); if (card && home && card.parentElement !== home) home.append(card); });   // every way out (Close, Escape, Test again)
  dialog.querySelector('form').addEventListener('submit', event => event.preventDefault());   // Enter in the address field saved it (change) and must not close the dialog
  $('aon-notify-close').addEventListener('click', () => dialog.close());
  $('aon-notify-test').addEventListener('click', () => { dialog.close(); testAgain(); });
  $('notify-telegram-connect').addEventListener('click', () => dialog.close());   // the card's own button then opens the Telegram connection
}
