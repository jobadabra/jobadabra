// The owner's answer to a feedback this person sent, as a card at the top of the app ("Fixed in 0.9.12", "Noted: not now"). Cards come from the main process
// (lib/app-feedback-replies.js asks the website); closing one tells the site, which stops showing it. Looks like the run banner (run-banner.css), one primary button.
// Guarded by test/unit/renderer/feedback-reply-card.test.js.
import {el, tile} from '../components.js';
import {$} from './core.js';
import {cardText, newFixedRefs} from '../feedback-reply-text.js';

const EVERY = 15 * 60 * 1000;   // Why (Gitar on #3044): the main process asks the site at most every 6 hours, or 15 minutes after a failed ask, and holds the answer; asking it this often costs nothing and lets that retry happen
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

/** Draws the cards now and re-reads them every 15 minutes (the main process asks the website at most every 6 hours, 15 minutes after a failed ask, and holds the answer). Takes nothing; a window without the bridge or an
 *  answer that fails draws nothing and never throws. The data comes from window.pilot.feedbackReplies (lib/app-feedback-replies.js). */
export async function init() {
  const box = $('feedback-replies');
  if (!box || !window.pilot?.feedbackReplies) return;
  const seen = new Set();
  const ask = async () => {
    const replies = await window.pilot.feedbackReplies().catch(() => []);
    drawReplies(box, replies, ref => window.pilot.feedbackReplyClose(ref).catch(() => {}));
    // Why (code review, 5 Nov 2026): the main process has asked the site again before this card came (a thank-you adds free applications); the chip and the Plan page read it now, not at the next 10-minute look.
    if (newFixedRefs(replies, seen).length) window.dispatchEvent(new Event('allowance-changed'));
  };
  ask();
  setInterval(ask, EVERY);
}
