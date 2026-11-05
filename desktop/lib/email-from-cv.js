// The e-mail address the CV states, offered with the consent switch (lib/email-consent.js owns the consent). Its own file: it reads the CV and Your details,
// which reach the store and the pipeline, so only the IPC layer imports it (notify-channel imports email-consent, and the pipeline imports notify-channel).
// Guard: test/unit/main/email-consent.test.js.
import * as cv from './cv.js';
import * as contactDetails from './contact.js';
import {LINE} from '../renderer/email-consent-words.js';
import {consented, shouldAsk} from './email-consent.js';

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The address the CV states (cv.json links, a mailto: the import kept), else the one in Your details. '' when neither. Never sends or stores it. */
export async function cvAddress(storage) {
  const linked = (cv.baseCv(storage)?.links || []).map(link => String(link?.href || '').replace(/^mailto:/i, '').split('?')[0].trim()).find(value => ADDRESS.test(value));
  if (linked) return linked.toLowerCase();
  const details = String((await contactDetails.read(storage).catch(() => ({}))).email || '').trim();
  return ADDRESS.test(details) ? details.toLowerCase() : '';
}

/** What the window draws: the CV's address, whether it is consented, and which places still ask. */
export async function view(storage) {
  const address = (consented(storage) && storage.settings().notifyEmail) || await cvAddress(storage);
  return {address, consented: consented(storage), wording: LINE, askCv: !!address && shouldAsk(storage, 'cv'), askAlwaysOn: !!address && shouldAsk(storage, 'alwaysOn')};
}
