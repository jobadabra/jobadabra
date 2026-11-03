// The owner's answer to a feedback this person sent, as a card at the top of the app ("Fixed in 0.9.12", "Noted: not now"). Cards come from the main process
// (lib/app-feedback-replies.js asks the website); closing one tells the site, which stops showing it. Looks like the run banner (run-banner.css), one primary button.
// Guarded by test/feedback-reply-card.test.js.
import {el, tile} from '../components.js';
import {$} from './core.js';
import {cardText} from '../feedback-reply-text.js';

const EVERY = 60 * 60 * 1000;   // the main process asks the site at most every 6 hours; this only reads what it holds
/** Draws the cards into `box`; `onClose(ref)` when the person presses "Got it". */
export function drawReplies(box, replies, onClose) {
  box.replaceChildren(...replies.map(reply => {
    const text = cardText(reply), card = el('section', `card run-banner tone-${text.tone} feedback-reply`), words = el('div', 'run-banner-words');
    const close = Object.assign(el('button', 'primary', 'Got it'), {type: 'button', onclick: () => { card.remove(); box.hidden = !box.children.length; onClose(reply.ref); }});
    words.append(el('b', '', text.title), el('span', 'muted', text.said), el('span', '', text.answer));
    card.append(tile('chat', text.tone), words, close);
    return card;
  }));
  box.hidden = !replies.length;
}

/** Draws the cards now and re-reads them every hour (the main process asks the website at most every 6 hours and holds the answer). Takes nothing; a window without the bridge or an
 *  answer that fails draws nothing and never throws. The data comes from window.pilot.feedbackReplies (lib/app-feedback-replies.js). */
export async function init() {
  const box = $('feedback-replies');
  if (!box || !window.pilot?.feedbackReplies) return;
  const ask = async () => drawReplies(box, await window.pilot.feedbackReplies().catch(() => []), ref => window.pilot.feedbackReplyClose(ref).catch(() => {}));
  ask();
  setInterval(ask, EVERY);
}
