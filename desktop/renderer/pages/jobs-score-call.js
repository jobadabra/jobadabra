// Jobs' scores-to-refresh surface (owner, 2 Nov 2026; moved 5 Nov 2026: "let's move this into this card"): the old-scores notice and its Re-score button are a row of the Jobs bar
// now (rescore-entry.js, drawn by pages/focus-suggestions.js); this callout (#jobs-unscored) is only "N jobs are not scored yet", and a re-score has its own card (#rescore-card,
// drawn while <body data-rescoring> shows it). The count and the running state are pages/rescore-run.js's, the words rescore-words.js's: the same as Strategy's notice.
// Guarded by test/unit/renderer/rescore-call.test.js and desktop/integration/app/screen-jobs-rescore.test.js.
import {el} from '../components.js';
import {$, show} from './core.js';
import {rescoringLead, rescoringTitle} from '../rescore-words.js';
import {rescoring} from './rescore-run.js';

/** Draw the not-scored callout and the re-score card from the state. unscored: how many open jobs have no score yet; searching: the Find jobs card is on "Finding jobs…". */
export function paintScoreCall(unscored, searching) {
  const call = $('jobs-unscored'), running = rescoring();
  $('jobs-unscored-text').textContent = `${unscored} jobs are not scored yet. The AI scores new jobs during each check; if this stays, open Recent activity to see why (Claude Code not answering, a usage limit), or Settings → Connections → AI.`;
  show(call, unscored >= 5 && !searching && !running);   // while a search runs they are being scored: the card on top says so
  const card = $('rescore-card');
  if (running) {
    const head = el('div', 'find-head');
    head.append(Object.assign(el('span', 'spinner'), {ariaHidden: 'true'}), el('h3', 'find-title', rescoringTitle(running.count)));
    card.replaceChildren(head, el('p', 'muted find-lead', rescoringLead));
  } else card.replaceChildren();
}

/** The callout's button: Find jobs (the check scores what is not scored yet). */
export const wireScoreCall = ({find}) => {
  $('jobs-unscored-go').addEventListener('click', () => find());
};
