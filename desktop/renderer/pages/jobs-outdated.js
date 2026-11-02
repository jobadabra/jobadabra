// Jobs, when the running app is older than its engine (it was updated while open): one Restart card instead of a list read from the wrong folders.
// Why (2 Nov 2026, owner): after the rename the engine refused the old app's runs; the cached list stayed on screen with no score and no word.
// The engine's refusal reaches here as the one restart line (lib/pipeline-commands.js jobs, renderer/errors.js). Guarded by test/jobs-outdated-card.test.js.
import {OUTDATED_LINE_FINISH, relaunch} from '../errors.js';
const $ = id => document.getElementById(id);   // not pages/core.js: it reads the app's state at import, and this card must draw when that read failed

const LIST = ['jobs-split', 'jobs-head', 'jobs-empty', 'jobs-unscored'];   // what the card replaces
let kept = null;   // each one's hidden flag before the card, so the list comes back as the page had it

/** Called after every redraw of the list (renderJobs): while the card shows, what it replaces stays hidden. One owner of this state. */
export function keepListHidden() {
  if (kept) for (const id of LIST) if ($(id)) $(id).hidden = true;
}

/** on: draw the card and hide the list; off: remove the card and give the list back its own state. */
export function showOutdatedJobs(on) {
  const card = $('jobs-outdated');
  if (!card) return;
  if (on && !kept) kept = Object.fromEntries(LIST.map(id => [id, $(id)?.hidden]));
  if (!on && !kept) { card.hidden = true; return; }
  if (on) {
    const button = Object.assign(document.createElement('button'), {className: 'primary', type: 'button', textContent: 'Restart Jobadabra'});
    button.addEventListener('click', () => { button.disabled = true; relaunch(); });
    const words = Object.assign(document.createElement('span'), {textContent: OUTDATED_LINE_FINISH});
    card.replaceChildren(words, ' ', button);
  }
  card.hidden = !on;
  for (const id of LIST) if ($(id)) $(id).hidden = on ? true : kept[id];
  if (!on) kept = null;
}
