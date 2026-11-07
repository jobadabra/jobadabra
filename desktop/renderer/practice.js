// The practice run in the window (spec 2026-11-07-practice-jobs-design.md, PR 3/4): asks the main process once whether this is one (lib/practice-mode.js) and, if so, draws the banner at the top of the app.
// `practice.on` is read by the job drawer's Application tab. A person's app answers off and draws nothing.
import {el, tile} from './components.js';
import {PRACTICE_WORDS as W} from './practice-words.js';

export const practice = {on: false};

/** Reads the answer, then draws the banner into `box` (the `#practice-banner` slot at the top of the main area) when it is a practice run. */
export async function init(box) {
  practice.on = !!(await window.pilot?.practiceInfo?.().catch(() => null))?.on;
  if (!box || !practice.on) return;
  const card = el('section', 'card run-banner tone-warn practice-banner'), words = el('div', 'run-banner-words');
  words.append(el('b', '', W.bannerTitle), el('span', '', W.bannerText));
  card.append(tile('shield', 'warn'), words);
  box.hidden = false;
  box.replaceChildren(card);
}
