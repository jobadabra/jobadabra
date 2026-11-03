// Jobs' scores-to-refresh surface (owner, 2 Nov 2026): the ONE callout (#jobs-unscored) says either "N scores are from your previous search settings" with a
// Re-score button (data-kind="stale", very visible, above the list) or "N jobs are not scored yet" (as before); a re-score has its own card (#rescore-card, drawn
// while <body data-rescoring> shows it). The count and the running state are pages/rescore-run.js's, the words rescore-words.js's: the same as Strategy's notice.
// Guarded by test/unit/renderer/rescore-call.test.js and desktop/integration/app/screen-jobs-rescore.test.js.
import {el} from '../components.js';
import {$, show} from './core.js';
import {callButton, callHint, noticeTitle, rescoringLead, rescoringTitle} from '../rescore-words.js';
import {knownOutdated, rescoring} from './rescore-run.js';

/** Draw the callout and the re-score card from the state. unscored: how many open jobs have no score yet; searching: the Find jobs card is on "Finding jobs…". */
export function paintScoreCall(unscored, searching) {
  const call = $('jobs-unscored'), count = knownOutdated().count, running = rescoring();
  const stale = count > 0 && !running;
  call.dataset.kind = stale ? 'stale' : 'unscored';
  const go = $('jobs-unscored-go');
  go.className = stale ? 'primary' : 'link';
  go.disabled = stale && searching;   // a plain Find jobs search runs: a re-score waits for it (one run at a time)
  if (stale) {
    $('jobs-unscored-text').textContent = `${noticeTitle(count)} ${callHint}`;
    go.textContent = callButton(count);
  } else {
    $('jobs-unscored-text').textContent = `${unscored} jobs are not scored yet. The AI scores new jobs during each check; if this stays, open Recent activity to see why (Claude Code not answering, a usage limit), or Settings → Connections → AI.`;
    go.textContent = 'Check now';
  }
  show(call, stale || (unscored >= 5 && !searching && !running));   // while a search runs they are being scored: the card on top says so
  const card = $('rescore-card');
  if (running) {
    const head = el('div', 'find-head');
    head.append(Object.assign(el('span', 'spinner'), {ariaHidden: 'true'}), el('h3', 'find-title', rescoringTitle(running.count)));
    card.replaceChildren(head, el('p', 'muted find-lead', rescoringLead));
  } else card.replaceChildren();
}

/** The callout's button: Re-score (stale) or Find jobs (not scored yet, as before). */
export const wireScoreCall = ({rescore, find}) => {
  $('jobs-unscored-go').addEventListener('click', () => (knownOutdated().count > 0 ? rescore(knownOutdated().count) : find()));
};
