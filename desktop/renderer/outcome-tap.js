import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The "How did it go?" choices on a job's menu: which outcomes make sense for the stage it is at (desktop/lib/outcomes.js writes them).
import {ENDED} from './jobs-view.js';

const WAITING = new Set(['Applied', 'Confirmation received']);
const TALKING = new Set(['Screening', 'Interview scheduled', 'Interviewing']);
// where: the store's name (renderer/store-words.js storeName(), passed in: this module stays free of the window's state for its tests).
const note = where => t('helperRest.outcomePrivacy', {where});

/** Return stage-appropriate outcome actions with localized labels and canonical payloads. */
export function outcomeChoices(stage, where = t('helperRest.outcomeYourData')) {
  const all = {
    reply: {outcome: 'reply', icon: 'chat', label: t('helperRest.outcomeReply'), title: `${t('helperRest.outcomeReplied')} ${note(where)}`},
    screening: {outcome: 'screening', icon: 'calendar', label: t('helperRest.outcomeScreening'), title: `${t('helperRest.outcomeScheduled')} ${note(where)}`},
    offer: {outcome: 'offer', icon: 'check', label: t('helperRest.outcomeOffer'), title: `${t('helperRest.outcomeOffered')} ${note(where)}`},
    rejected: {outcome: 'rejected', icon: 'close', label: t('helperRest.outcomeRejected'), title: `${t('helperRest.outcomeSaidNo')} ${note(where)}`},
    no_response: {outcome: 'no_response', icon: 'clock', label: t('helperRest.outcomeClose'), title: `${t('helperRest.outcomeNoReply')} ${note(where)}`},
  };
  if (WAITING.has(stage)) return [all.reply, all.screening, all.offer, all.rejected, all.no_response];
  if (TALKING.has(stage)) return [all.offer, all.rejected];
  return [];
}

// A closed application (rejected, withdrawn, no answer) can be put back to Applied: a mistaken or changed outcome, a late reply.
export const reopenable = stage => ENDED.has(stage);
