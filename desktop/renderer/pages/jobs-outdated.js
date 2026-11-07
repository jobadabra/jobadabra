// Jobs, when the running app is older than its engine (it was updated while open): one Restart card instead of a list read from the wrong folders.
// Why (2 Nov 2026, owner): after the rename the engine refused the old app's runs; the cached list stayed on screen with no score and no word.
// The engine's refusal reaches here as the one restart line (lib/pipeline-commands.js jobs, renderer/errors.js). One owner of the state: <body data-jobs-outdated>,
// which style.css turns into "the list is hidden" whoever shows it and in whatever order (Gitar on #3015: a hide call that has to run last is a trap).
// Guarded by test/unit/renderer/jobs-outdated-card.test.js.
import {t} from '../../i18n/index.js';
import {OUTDATED_LINE_FINISH, relaunch} from '../errors.js';

const $ = id => document.getElementById(id);   // not pages/core.js: it reads the app's state at import, and this card must draw when that read failed

/** on: draw the card and hide the list; off: remove the card and let the list show as the page has it. */
export function showOutdatedJobs(on) {
  const card = $('jobs-outdated');
  if (!card) return;
  if (on) {
    const button = Object.assign(document.createElement('button'), {className: 'primary', type: 'button', textContent: t('pagesCommon.restartJobadabra')});
    button.addEventListener('click', () => { button.disabled = true; relaunch(); });
    const words = Object.assign(document.createElement('span'), {textContent: OUTDATED_LINE_FINISH});
    card.replaceChildren(words, ' ', button);
    document.body.dataset.jobsOutdated = '1';
  } else delete document.body.dataset.jobsOutdated;
  card.hidden = !on;
}
