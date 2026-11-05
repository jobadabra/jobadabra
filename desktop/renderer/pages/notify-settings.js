// Settings → Notifications ("Tell me by"): e-mail, app notifications, Telegram, any mix, plus the address, how often the digest comes and the product-news tick (pre-checked, unsubscribe in one click).
// Its own Settings tab after Automation (owner, 3 Nov 2026: "Notifications should be a separate tab in Settings. Not inside Automations"); saves at once like Automation. The choice and the address live in lib/notify-channel.js; the engine and the Always on repo follow it. The words (why a switch does nothing) are
// renderer/notify-words.js; guard test/unit/renderer/notify-choice.test.js.
import {$} from './core.js';
import {shared} from './shared.js';
import {notes} from '../notify-words.js';
import {openSetting} from './settings.js';
import {forgetEmailState} from './setup-email-card.js';
import {plainError} from '../run-warnings.js';

const BOXES = {email: 'notify-email', app: 'notify-app', telegram: 'notify-telegram'};
let busy = false;

// `error`: the last save's refusal, kept on screen (the refresh after a save used to wipe it, so a switch flipped back without a word).
export async function showNotify(error = '') {
  const state = await window.pilot.notifyState().catch(() => null);
  if (!state) return;
  if (shared.state) Object.assign(shared.state, {notifyBy: state.by, settings: {...shared.state.settings, notifyBy: state.chosen}});   // Connections and the Actions header follow the choice at once
  for (const [name, id] of Object.entries(BOXES)) $(id).checked = state.by.includes(name);
  $('notify-address').value = state.email || '';
  $('notify-marketing').checked = state.marketing;
  $('notify-cadence').value = state.cadence || 'daily';
  $('notify-telegram').disabled = !state.telegram;
  const said = notes(state, error);
  $('notify-telegram-note').textContent = said.telegram;
  $('notify-telegram-connect').hidden = state.telegram;
  $('notify-resend').hidden = !state.email || !state.reached || state.confirmed;   // unknown while the site is unreachable, and a confirmed address has nothing to confirm
  $('notify-email-note').textContent = said.email;
  $('notify-message').textContent = plainError(said.message);
}

export function bindNotify({savedToast, updateRepo}) {
  const save = async () => {
    if (busy) return;
    busy = true;
    let error = '';
    try {
      const by = Object.entries(BOXES).filter(([, id]) => $(id).checked).map(([name]) => name);
      const result = await window.pilot.notifySave({by, email: $('notify-address').value, marketing: $('notify-marketing').checked, cadence: $('notify-cadence').value});
      error = result.ok ? '' : result.error;
      forgetEmailState();   // Overview's Email card asks again
      window.dispatchEvent(new Event('notify-changed'));   // the Suggestions card asks again
      if (result.ok) { savedToast('Saved ✓', `Tell me by: ${by.join(', ') || 'nothing'}`, 'notifications'); updateRepo(); }
    } finally { busy = false; }
    await showNotify(error);
  };
  for (const id of [...Object.values(BOXES), 'notify-address', 'notify-marketing', 'notify-cadence']) $(id).addEventListener('change', save);
  $('notify-telegram-connect').addEventListener('click', () => openSetting('telegram'));
  // Why (5 Nov 2026, owner): the card also lives in Always on's Test pop-up, where an address is confirmed right away; one button for both places.
  $('notify-resend').addEventListener('click', async () => {
    const sent = await window.pilot.notifyResend().catch(error => ({ok: false, error: error.message}));
    $('notify-message').textContent = plainError(sent?.ok ? 'Sent. Check your inbox and your spam folder for the link.' : sent?.error || 'Try again in a minute.');
  });
  window.addEventListener('notify-refresh', () => showNotify());   // the Test pop-up borrows this card and asks it to read the state again
}
