// The words of "How we protect your data": the privacy line in the Always on card and the popup behind its link (owner, 5 Nov 2026: "have a button/link when the user activates this option,
// where a Popup opens and we explain all the security measurements we're taking"). Pure: renderer/pages/always-on-protect.js draws it.
// Why (5 Nov 2026): every line below was checked against the code on the day it shipped, and the popup never claims more than it. Where each is true: docs/superpowers/specs/2026-11-04-always-on-one-choice.md
// (the "How we protect your data" table). The CV file is not sent to our servers (lib/hosted-search.js config: cv ''), so no line says we store it. Found jobs and the schedule are NOT encrypted with the person's key, so nothing here says "everything is encrypted". Guard: test/unit/renderer/always-on-protect-words.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const LINK = t('helperMore.protectData');
export const TITLE = t('helperMore.protectData');
// The owner's exact line (5 Nov 2026), shown in the card while "on our servers" is the picked way.
export const NOTE = t('helperMore.profileEncrypted');
export const LEAD = t('helperMore.protectLead');

const IN_PLACE = [t('helperMore.inPlace'), 'good', 'check-circle'], KNOW = [t('helperMore.goodKnow'), 'info', 'info'], NOT = [t('helperMore.whatNot'), 'warn', 'info'];

/** The measures, in the order the popup shows them: six protections, one thing to know, then what it is not. `chip` = [word, tone, icon]. */
export const MEASURES = [
  {id: 'rest', title: t('helperMore.encryptedStored'), chip: IN_PLACE,
    text: t('helperMore.encryptedStoredText')},
  {id: 'transit', title: t('helperMore.encryptedTransit'), chip: IN_PLACE,
    text: t('helperMore.httpsOnly')},
  {id: 'apart', title: t('helperMore.keptApart'), chip: IN_PLACE,
    text: t('helperMore.containerAccount')},
  {id: 'nothing', title: t('helperMore.nothingContainer'), chip: IN_PLACE,
    text: t('helperMore.freshContainer')},
  {id: 'secret', title: t('helperMore.noPasswordLying'), chip: IN_PLACE,
    text: t('helperMore.runPassOnly')},
  {id: 'delete', title: t('helperMore.deleteAnytime'), chip: IN_PLACE,
    text: t('helperMore.deleteServers')},
  {id: 'ai', title: t('helperMore.aiReadsData'), chip: KNOW,
    text: t('helperMore.aiReadsProfile')},
  {id: 'not', title: t('helperMore.notEndToEnd'), chip: NOT,
    text: t('helperMore.notEndToEndText')},
];
