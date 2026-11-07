// The connection pop-ups (lib/notify-moments.js; spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): an address that waits for its link (day 3, day 10, the stop), an application that waited,
// Full automation with nobody to tell, and what the window itself detects (a strong match or Gmail updates while the person was away: renderer/notify-detect.js; a recruiter waiting: Focus).
// All of them offer themselves to the one pop-up slot (renderer/popup-slot.js): at most one opens per app open, each once (the app records it as it opens). The control follows the state:
// an e-mail field (no address), "send the link again" (waiting or stopped), or the way to Notifications (unsubscribed); "Use Telegram" opens Settings → Notifications. Guard: test/unit/renderer/notify-moment-words.test.js.
import {t} from '../../i18n/index.js';
import {$, message} from './core.js';
import {NO_PLACE} from '../targets.js';
import {momentWords} from '../notify-words.js';
import {matchWhileAway, updatesWhileAway} from '../notify-detect.js';
import {saveChoice} from '../notify-suggestion.js';
import {validEmail} from '../hosted-suggestion.js';
import {slot} from '../popup-slot.js';
import {openNotifications} from './notify-commands.js';
import {toastMessage} from './startup.js';

const FIRST_MS = 3000;
// Why (2 Nov 2026, spec): an application that waited is the most urgent; the address is time-limited; a match, an update or a recruiter can wait for a later app open.
const RANK = {waited: 3, day3: 2, day10: 2, stopped: 2, lost: 2, match: 1, reply: 1, recruiter: 1};

/** Binds the dialog once at start: asks the main process 3 s after load, offers what is due (and what the window detects) to the slot. A failed read shows nothing. */
export function init() {
  const dialog = $('notify-moment-dialog');
  if (!dialog) return;
  let current = null, answer = null, recruiter = null;
  const field = $('notify-moment-field'), email = $('notify-moment-email'), go = $('notify-moment-go'), telegram = $('notify-moment-telegram');

  const offer = moment => slot.offer({id: `notify-${moment.moment}`, rank: RANK[moment.moment], open: async () => {
    if (dialog.open || document.querySelector('dialog[open]')) return false;
    const words = momentWords(moment, answer.state);
    current = {moment, ask: words.ask};
    $('notify-moment-title').textContent = words.title;
    $('notify-moment-text').textContent = words.body;
    $('notify-moment-note').textContent = '';
    $('notify-moment-later').textContent = words.later;
    go.textContent = words.go;
    email.value = '';
    field.hidden = words.ask !== 'email';
    telegram.hidden = words.ask !== 'email';
    go.disabled = words.ask === 'email';
    await window.pilot.notifyMomentShown(moment.moment);   // once: recorded as it opens, so Escape or Not now never brings it back
    dialog.showModal();
    return true;
  }});

  async function detect() {
    const {seenAt, backAt, done} = answer;
    const wantMatch = !done.match, wantUpdates = !done.reply;
    if ((wantMatch || wantUpdates) && seenAt && backAt) {
      const [{runs = []} = {}, {jobs = []} = {}] = await Promise.all([window.pilot.runs().catch(() => ({})), wantMatch ? window.pilot.jobs().catch(() => ({})) : {}]);
      const match = wantMatch && matchWhileAway({runs, jobs, seenAt, backAt}), updates = wantUpdates && updatesWhileAway({runs, seenAt, backAt});
      if (match) offer({moment: 'match', ...match});
      if (updates) offer({moment: 'reply', ...updates});
    }
    if (recruiter && !done.recruiter) offer({moment: 'recruiter', ...recruiter});
  }

  async function ask() {
    answer = await window.pilot.notifyMoment().catch(() => null);
    if (!answer?.allowed) return;
    if (answer.moment) offer(answer.moment);
    await detect().catch(() => {});
  }

  // Focus found "Reply today" cards (pages/focus-suggestions.js): a recruiter or employer waits for an answer.
  window.addEventListener('focus-reply-waiting', event => {
    recruiter = event.detail;
    if (answer?.allowed && !answer.done.recruiter) offer({moment: 'recruiter', ...recruiter});
  });

  $('notify-moment-later').addEventListener('click', () => dialog.close());
  telegram.addEventListener('click', () => { dialog.close(); openNotifications(); });
  email.addEventListener('input', () => { go.disabled = !validEmail(email.value.trim()); });
  go.addEventListener('click', async () => {
    if (current?.ask === 'notifications') { dialog.close(); openNotifications(); return; }
    const sent = current?.ask === 'email'
      ? await window.pilot.notifySave(saveChoice(answer.state, email.value.trim())).catch(error => ({ok: false, error: error.message}))
      : await window.pilot.notifyResend().catch(error => ({ok: false, error: error.message}));
    if (!sent?.ok) { message('notify-moment-note', sent?.error || t('pagesCommon.minute'), 'bad'); return; }   // message(): the one place a result reaches the screen (plainError)
    dialog.close();
    window.dispatchEvent(new Event('notify-changed'));   // the card asks again
    toastMessage(current.ask === 'email' ? 'Check your inbox ✓' : 'Sent again ✓', 'Check your inbox (and your spam folder) for the link.', NO_PLACE.itself, 'good');
  });
  setTimeout(ask, FIRST_MS);
}
