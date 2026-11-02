// The pop-up for an e-mail address that waits for its confirm link (lib/notify-moments.js; spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): day 3, day 10, and the day-14 stop.
// Shown once per moment (the app records it when it opens), through the one pop-up slot (renderer/popup-slot.js); its button sends the link again (jobadabra-web #333).
import {$, message} from './core.js';
import {NO_PLACE} from '../targets.js';
import {momentWords} from '../notify-words.js';
import {slot} from '../popup-slot.js';
import {toastMessage} from './startup.js';

const FIRST_MS = 3000;

/** Binds the dialog once at start: asks the main process 3 s after load for a moment and offers it to the slot (rank 2: a missed check or a first Gmail ask can wait, the address is time-limited). A failed read shows nothing. */
export function init() {
  const dialog = $('notify-moment-dialog');
  if (!dialog) return;
  async function ask() {
    const moment = await window.pilot.notifyMoment().catch(() => null);
    if (!moment) return;
    slot.offer({id: 'notify-address', rank: 2, open: async () => {
      if (dialog.open || document.querySelector('dialog[open]')) return false;
      const words = momentWords(moment);
      $('notify-moment-title').textContent = words.title;
      $('notify-moment-text').textContent = words.body;
      $('notify-moment-note').textContent = '';
      $('notify-moment-go').textContent = words.go;
      $('notify-moment-later').textContent = words.later;
      await window.pilot.notifyMomentShown(moment.moment);   // once: recorded as it opens, so Escape or Not now never brings it back
      dialog.showModal();
      return true;
    }});
  }
  $('notify-moment-later').addEventListener('click', () => dialog.close());
  $('notify-moment-go').addEventListener('click', async () => {
    const done = await window.pilot.notifyResend().catch(error => ({ok: false, error: error.message}));
    if (!done?.ok) { message('notify-moment-note', done?.error || 'Try again in a minute.', 'bad'); return; }   // message(): the one place a result reaches the screen (plainError)
    dialog.close();
    toastMessage('Sent again ✓', 'Check your inbox (and your spam folder) for the link.', NO_PLACE.itself, 'good');
  });
  setTimeout(ask, FIRST_MS);
}
