// Send feedback (sidebar and Help → Send Feedback…): a note to the owner (lib/app-feedback.js → the website → the owner's Telegram). The user's own words; a contact only if they type one.
// Opening it first asks the main process for the window's picture (taken BEFORE this dialog draws over the app) and the redacted logs; "See what's sent" shows that exact text.
import {$} from './core.js';
import {toastMessage} from './startup.js';
import {NO_PLACE} from '../targets.js';
import {plainError} from '../run-warnings.js';

let prepared = {shot: null, logs: null};

// One state: the checkbox. The thumbnail shows while it is on and a picture exists; the × turns it off.
function drawShot() {
  const on = $('app-feedback-include-shot').checked && !!prepared.shot;
  $('app-feedback-shot').hidden = !on;
  if (on) $('app-feedback-shot-img').src = prepared.shot.dataUrl;
  $('app-feedback-include-shot').disabled = !prepared.shot;
  $('app-feedback-shot-note').textContent = prepared.shot ? 'It shows what is on screen in Jobadabra right now (only this window, nothing else on your computer). Remove it if it shows anything private.'
    : 'The window could not be captured, so no screenshot goes with this.';
}

async function open() {
  $('app-feedback-message').textContent = '';
  const screen = document.querySelector('.nav.active')?.dataset.view || '';
  prepared = await window.pilot.feedbackPrepare(screen).catch(() => ({shot: null, logs: null}));
  $('app-feedback-include-shot').checked = !!prepared.shot;
  $('app-feedback-include-logs').checked = !!prepared.logs;
  $('app-feedback-logs').closest('details').hidden = !prepared.logs;   // the preview shows whenever the logs are ticked, also after an earlier open unticked them
  $('app-feedback-logs').textContent = prepared.logs?.text || 'No logs could be read.';
  $('app-feedback-include-logs').disabled = !prepared.logs;
  drawShot();
  $('app-feedback-dialog').showModal();
  $('app-feedback-text').focus();
}

export async function init() {
  $('nav-feedback').addEventListener('click', open);
  window.pilot.onOpenFeedback(open);
  $('app-feedback-include-shot').addEventListener('change', drawShot);
  $('app-feedback-shot-remove').addEventListener('click', () => { $('app-feedback-include-shot').checked = false; drawShot(); });
  $('app-feedback-include-logs').addEventListener('change', () => { $('app-feedback-logs').closest('details').hidden = !$('app-feedback-include-logs').checked; });
  $('app-feedback-send').addEventListener('click', async event => {
    event.preventDefault();
    const button = $('app-feedback-send');
    button.disabled = true;
    $('app-feedback-message').textContent = 'Sending…';
    const include = {screenshot: $('app-feedback-include-shot').checked, logs: $('app-feedback-include-logs').checked};
    const result = await window.pilot.sendFeedback($('app-feedback-text').value, $('app-feedback-contact').value, include)
      .catch(error => ({ok: false, error: error.message}));
    button.disabled = false;
    if (!result?.ok) { $('app-feedback-message').textContent = plainError(result?.error || 'Couldn\'t send it.'); return; }
    $('app-feedback-text').value = '';
    prepared = {shot: null, logs: null};
    $('app-feedback-dialog').close();
    const left = result.skipped?.length ? ` (without the ${result.skipped.join(' and the ')}: too big)` : '';
    toastMessage('Thank you!', `Your feedback went straight to the maker${left}. If you left a contact, expect a reply.`, NO_PLACE.done, 'good');
  });
}
