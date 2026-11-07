// The invitation to tell us what went wrong, as a card at the top of the app (PR 3/7 of docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md). The main process decides when (lib/asks.js);
// this page draws what it holds. "Tell us" opens the Send feedback dialog; "Not now" is quiet for 14 days. Looks like the run banner (run-banner.css). Guarded by test/unit/renderer/ask-card.test.js.
import {t} from '../../i18n/index.js';
import {el, tile} from '../components.js';
import {$} from './core.js';
import {ASK_WORDS, answerAsk} from '../ask-card-text.js';

/** Draws the ask `kind` (or nothing for null/unknown) into `box`; `onAnswer('tell' | 'later')` when a button is pressed. */
export function drawAsk(box, kind, onAnswer) {
  const words = ASK_WORDS[kind];
  box.hidden = !words;
  if (!words) return void box.replaceChildren();
  const card = el('section', 'card run-banner tone-warn ask-card'), text = el('div', 'run-banner-words');
  const answer = how => Object.assign(el('button', how === 'tell' ? 'primary' : '', how === 'tell' ? 'Tell us' : t('pagesCommon.notNow')), {type: 'button', onclick: () => { box.hidden = true; box.replaceChildren(); onAnswer(how); }});
  text.append(el('b', '', words.title), el('span', '', words.body));
  card.append(tile('chat', 'warn'), text, answer('tell'), answer('later'));
  box.replaceChildren(card);
}

/** Reads the open ask from the main process now and whenever it announces one; "Tell us" presses the Send feedback entry so the dialog takes the window's picture as for any report. A window without the bridge draws nothing. */
export async function init() {
  const box = $('ask-card');
  if (!box || !window.pilot?.asksPending) return;
  let kind = null;
  const show = async () => { kind = await window.pilot.asksPending().catch(() => null); drawAsk(box, kind, how => answerAsk(kind, how, {pilot: window.pilot, openFeedback: () => $('nav-feedback')?.click()})); };
  window.pilot.onAskMoment?.(show);
  show();
}
