// Strategy's one "scored using previous search settings" notice, under the tabs (owner, 18 Oct 2026: "one consolidated notice", "count unique
// affected jobs", "saving settings must not silently start a paid re-score", "while running, show progress and prevent duplicate starts"; it was two
// rows of the Improve-your-search panel, older scores and other places, 17 Oct 2026). The engine counts each job once whatever its reasons, from the
// SAVED settings (src/desktop_strategy.py outdated); Re-score starts only from its dialog's own button and queues each job once (rescore-outdated); the running state and the start are pages/rescore-run.js's, shared with Jobs.
// Kept apart from Suggestions: a recommendation and an outdated score are different things. Guarded by test/unit/renderer/strategy-rescore.test.js and
// tests/unit/ai/test_strategy_outdated.py.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el, tile} from '../components.js';
import {wand} from '../magic.js';
import {$, show} from './core.js';
import {startSearch} from './jobs.js';
import {toastMessage} from './startup.js';
import {confirmRescore, knownOutdated, noteOutdated, rescoring} from './rescore-run.js';
import {noticeTitle, reasonsText, rescoringLead, rescoringTitle} from '../rescore-words.js';

let reloadStrategy = () => {}, shown = null;
// outdated: {count, method, places} from the strategy read (none: nothing outdated); reload: reads Strategy again when the re-score ends.
// fresh: this is a read's own value, so it is the one count Jobs and the Find jobs gate see too; a redraw from the shared state (fresh false) never writes it back.
// Why (3 Nov 2026, Gitar on #3024): redrawing from the value cached at the last read put an old count back after a newer Jobs read said 0, and every Find press asked "Score first".
export function drawOutdated(outdated, reload, {fresh = true} = {}) {
  reloadStrategy = reload;
  if (fresh) noteOutdated(outdated);   // Jobs' call to action and the Find jobs gate read the same count
  shown = fresh ? outdated : knownOutdated();
  outdated = shown;
  const box = $('strategy-outdated');
  const count = outdated?.count || 0;
  const busy = !!rescoring();
  if (!count) { show(box, false); box.replaceChildren(); return; }
  const words = el('div', 'notice-words');
  const title = el('b', '', busy ? rescoringTitle(count) : noticeTitle(count));
  words.append(title);
  if (busy) words.append(el('span', 'muted small', rescoringLead));
  else {
    const why = el('details', 'plain notice-why');
    why.append(el('summary', 'small', t('pagesStrategy.why')), el('span', 'muted small', `${reasonsText(outdated)}. Each job is counted once. Updating is optional.`));
    words.append(why);
  }
  const go = el('button', 'secondary item-action', busy ? t('pagesStrategy.rescoring') : t('pagesStrategy.rescoreJobs'));
  go.type = 'button';
  wand(go);
  go.disabled = busy;
  go.addEventListener('click', () => confirmRescore(count, {search: startSearch, reload: reloadStrategy, toast: toastMessage}));
  box.replaceChildren(tile('refresh', 'info'), words, go);
  show(box, true);
}
// The re-score started from Jobs (or here) changes the notice's words: drawn again from the one state (rescore-run.js).
document.addEventListener('rescore-state', () => { if ($('strategy-outdated') && shown) drawOutdated(null, reloadStrategy, {fresh: false}); });
