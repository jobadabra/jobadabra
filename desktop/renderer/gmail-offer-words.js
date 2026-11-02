// Gmail offered at the right moment (owner, 2 Nov 2026, spec docs/superpowers/specs/2026-11-02-gmail-offer-timing-design.md): the words of the two dialogs and the Suggestions card, free of the DOM so
// test/gmail-offer.test.js can check them. pages/gmail-offer.js draws the dialog and runs the one connect flow; lib/gmail-offer.js decides WHEN the window is told.
export const KEY = 'gmail:connect';

/** The dialog's words. `why`: 'applied' (the first Submit) or 'code' (a page asks for a code mailed to the person). */
export function offerWords({why, employer = '', host = ''} = {}) {
  if (why === 'code') {
    const site = String(host || '').replace(/^www\./, '');
    return {title: 'Connect Gmail and I\'ll type the code for you', yes: 'Connect Gmail', no: 'Not now',
      lead: `${site ? `${site} sent` : 'The site sent'} a code to your e-mail. Connect Gmail (read-only) and Jobadabra reads the codes and types them from the next job on. This job waits for you: type its code from your e-mail. The other jobs go on.`};
  }
  const from = String(employer || '').trim();
  return {title: 'Your first application is in', yes: 'Connect Gmail', no: 'Not now',
    lead: `Your confirmation${from ? ` from ${from}` : ''} will land in Gmail. Connect it, and Jobadabra moves this job to Interview or Rejected when they reply.`};
}

/**
 * The Suggestions card (Jobs bar and Focus): always there while Gmail is not connected (owner, 2 Nov 2026: "It should still be always present as in the Suggestions card"), so no Not now.
 * `view` is the window's read of the connection (pages/gmail-offer.js); not read yet → no flash of an offer.
 */
export function gmailEntries({view} = {}) {
  if (!view?.loaded || view.connected) return [];
  return [{kind: 'gmail', home: 'focus', topic: 'applying', key: KEY, title: 'Connect Gmail so replies move your jobs', source: '',
    detail: 'Confirmations and replies land on the right job, and the code an employer e-mails is typed for you.', evidence: [], answers: [], actions: [{label: 'Connect Gmail', do: 'connect_gmail'}]}];
}
