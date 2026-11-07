// Gmail offered at the right moment (owner, 2 Nov 2026, spec docs/superpowers/specs/2026-11-02-gmail-offer-timing-design.md): the words of the two dialogs and the Suggestions card, free of the DOM so
// test/unit/renderer/gmail-offer.test.js can check them. pages/gmail-offer.js draws the dialog and runs the one connect flow; lib/gmail-offer.js decides WHEN the window is told.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const KEY = 'gmail:connect';

/** The dialog's words. `why`: 'applied' (the first Submit) or 'code' (a page asks for a code mailed to the person). */
export function offerWords({why, employer = '', host = ''} = {}) {
  if (why === 'code') {
    const site = String(host || '').replace(/^www\./, '');
    return {title: t('helperMore.gmailCodeTitle'), yes: t('helperMore.gmailConnect'), no: t('helperState.notNow'),
      lead: t('helperMore.gmailCodeLead', {site: site || t('helperMore.theSite')})};
  }
  const from = String(employer || '').trim();
  return {title: t('helperMore.gmailFirstTitle'), yes: t('helperMore.gmailConnect'), no: t('helperState.notNow'),
    lead: t(from ? 'helperMore.gmailConfirmationFrom' : 'helperMore.gmailConfirmation', {employer: from})};
}

/**
 * The Suggestions card (Jobs bar and Focus): always there while Gmail is not connected (owner, 2 Nov 2026: "It should still be always present as in the Suggestions card"), so no Not now.
 * `view` is the window's read of the connection (pages/gmail-offer.js); not read yet → no flash of an offer.
 */
export function gmailEntries({view} = {}) {
  if (!view?.loaded || view.connected) return [];
  return [{kind: 'gmail', home: 'focus', topic: 'applying', key: KEY, title: t('helperMore.gmailSuggestTitle'), source: '',
    detail: t('helperMore.gmailSuggestDetail'), evidence: [], answers: [], actions: [{label: t('helperMore.gmailConnect'), do: 'connect_gmail'}]}];
}
