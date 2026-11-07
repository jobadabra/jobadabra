// Gmail offered at the right moment (owner, 2 Nov 2026, spec docs/superpowers/specs/2026-11-02-gmail-offer-timing-design.md): the ONE dialog behind the first Submit and a page that asks for a mailed code,
// the window's copy of "is Gmail connected" (for the Suggestions card and ⌘K), and the connect press, which is Settings' own button so there is one sign-in flow.
// Invariants: one dialog at a time; the main process decides when (lib/gmail-offer.js) and the window only shows what it is told; connected → nothing is shown. Guard: test/unit/renderer/gmail-offer.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';
import {offerWords} from '../gmail-offer-words.js';
import {slot} from '../popup-slot.js';

export const view = {loaded: false, connected: false};

/** Set the connection's state (Settings' Gmail card read it, or this module asked); tells the pages (Suggestions) when it changed. */
export function setGmailConnected(connected) {
  const before = view.connected, was = view.loaded;
  Object.assign(view, {loaded: true, connected: !!connected});
  if (!was || before !== view.connected) window.dispatchEvent(new Event('gmail-changed'));
}
/** Read the connection from the app. */
export async function refreshGmail() {
  const google = await window.pilot.googleStatus().catch(() => null);
  if (google) setGmailConnected(!!google.connected);
  return view;
}

/** Start the connect flow: the Settings card's own button (its warning dialog, the sign-in and the "Connected" line), whichever door was used. */
export const connectGmail = () => $('google-connect').click();

/** Show the dialog for `offer` ({why, employer, host}); resolves true when Connect was chosen. Never shown twice at once or once connected. */
export async function openGmailOffer(offer) {
  const dialog = $('gmail-offer-dialog');
  if (dialog.open) return false;
  const known = await refreshGmail();
  if (known.connected) return false;
  const words = offerWords(offer);
  $('gmail-offer-title').textContent = words.title;
  $('gmail-offer-lead').textContent = words.lead;
  $('gmail-offer-yes').textContent = words.yes;
  $('gmail-offer-no').textContent = words.no;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const yes = dialog.returnValue === 'default';
      if (yes) connectGmail();
      resolve(yes);
    }, {once: true});
    dialog.showModal();
  });
}

/** Start-up: the main process tells the window (first Submit, a mailed code). */
export function initGmailOffer() {
  // One connection pop-up per app open (renderer/popup-slot.js): the e-mailed code outranks the first Submit's ask (the job waits on it).
  window.pilot.onGmailOffer?.(offer => {
    slot.offer({id: `gmail-${offer.why}`, rank: offer.why === 'code' ? 2 : 1, open: async () => {
      if ($('gmail-offer-dialog').open || (await refreshGmail()).connected) return false;
      openGmailOffer(offer).catch(() => {});
      return true;
    }});
  });
  refreshGmail().catch(() => {});
}

/** The ⌘K command (pages/nav.js), only while Gmail is not connected. `add` is the palette's (group, label, hint, keywords, run). Why (2 Nov 2026): the branch lives here so nav.js's over-limit function does not grow. */
export const addGmailCommand = add => {
  if (view.loaded && !view.connected) add(t('pagesCommon.settings'), t('pagesCommon.connectGmail'), 'Replies move your jobs; mailed codes are typed for you', 'gmail google connect mail email calendar sign in', connectGmail);
};
