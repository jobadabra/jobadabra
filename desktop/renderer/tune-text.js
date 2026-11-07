import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The words of the Tune my strategy dialog, kept free of the DOM (like weekly-card.js) so the tests can check them.
const VERB = {drop_role: 'helperGuide.stopRole', drop_place: 'helperGuide.stopPlace', exclude_title: 'helperGuide.skipTitle'};

// A proposal's headline: what changes, in the user's words.
/** Name a proposed change while retaining the original role, place or title text. */
export const proposalTitle = item => `${t(VERB[item.kind] || 'helperGuide.change')} “${item.label}”`;

// The line under it: the counts it rests on (the engine's own sentence when it sent no counts).
/** Describe known action counts, preserving an engine reason when no counts exist. */
export const proposalCounts = item => (item.dismissed != null ? t('helperGuide.proposalCounts', {dismissed: item.dismissed, engaged: item.engaged || 0}) : item.why || '');

// The header under the title: what the proposals were read from (a lead and its counts), or why there are none yet.
export function basisParts(answer) {
  const b = answer.basis || {};
  if (!b.jobs) return {lead: t('helperGuide.noLearning'), counts: ''};
  const counts = `${t('helperGuide.proposalCounts', {dismissed: b.dismissed, engaged: b.engaged})} · ${t('helperRest.peerInterviews', {count: b.interviews})}`;
  const lead = t('helperGuide.basisJobs', {count: b.jobs});
  return answer.proposals?.length ? {lead, counts}
    : {lead: lead + t('helperGuide.nothingChange', {count: b.min_dismissed}), counts};
}

// The Apply button names how many ticked changes it writes.
/** Name the selected change count without changing which proposals are applied. */
export const applyLabel = ticked => (ticked ? t('helperGuide.applyCount', {count: ticked}) : t('helperGuide.applyChanges'));
