// Send feedback (sidebar and Help → Send Feedback…): a note to the owner (lib/app-feedback.js → the website → the owner's Telegram). The user's own words; a contact only if they type one.
// Opening it first asks the main process for the window's picture (taken BEFORE this dialog draws over the app), the redacted logs and this screen's data (renderer/feedback-data.js);
// "See what's sent" shows the exact held text of every part that is ticked, plus what is always sent.
import {$} from './core.js';
import {toastMessage} from './startup.js';
import {NO_PLACE} from '../targets.js';
import {plainError} from '../run-warnings.js';
import {readScreenData} from '../feedback-data.js';
import './feedback-screens.js';   // registers each page's data

let prepared = {shot: null, logs: null, page: null, profile: null, identity: null};
const PAGE_NOTE = "Its rows or questions with their ids, states and filters, so the problem can be reproduced. Never a job posting's text.";
const EMPTY = {shot: null, logs: null, page: null, profile: null, identity: null};

// One state: the checkbox. The thumbnail shows while it is on and a picture exists; the × turns it off.
function drawShot() {
  const on = $('app-feedback-include-shot').checked && !!prepared.shot;
  $('app-feedback-shot').hidden = !on;
  if (on) $('app-feedback-shot-img').src = prepared.shot.dataUrl;
  $('app-feedback-include-shot').disabled = !prepared.shot;
  $('app-feedback-shot-note').textContent = prepared.shot ? 'Only this Jobadabra window, as it is on screen. Remove it if it shows anything private.'
    : 'The window could not be captured, so no screenshot goes with this.';
}

// "See what's sent": what is always sent, then each ticked part's exact text. One state: the checkboxes plus what the main process holds.
function drawPreview() {
  const id = prepared.identity, contact = $('app-feedback-contact').value.trim();
  const sections = [['Always sent', [`app version: ${id?.version || '-'}`, `system: ${id?.platform || '-'}`, `install id: ${id?.install || '-'}`, `contact: ${contact || 'none'}`, 'your feedback text'].join('\n')]];
  if ($('app-feedback-include-page').checked && prepared.page) sections.push(["This screen's data", prepared.page.text]);
  if ($('app-feedback-include-profile').checked) sections.push(['Profile snapshot', prepared.profile ? prepared.profile.text : 'Reading your Profile…']);
  if ($('app-feedback-include-logs').checked && prepared.logs) sections.push(['Logs', prepared.logs.text]);
  $('app-feedback-logs').textContent = sections.map(([title, text]) => `===== ${title} =====\n${text}`).join('\n\n');
}

// The Profile is read only when the person turns it on (a Notion store takes seconds); a failed read turns the switch back off and says so.
async function profileChanged() {
  const box = $('app-feedback-include-profile');
  if (box.checked && !prepared.profile) {
    box.disabled = true;
    $('app-feedback-send').disabled = true;   // Why (Gitar on #3021): a Send during the read would leave the snapshot out without saying so
    drawPreview();
    const {profile} = await window.pilot.feedbackProfile().catch(() => ({profile: null}));
    prepared.profile = profile;
    box.disabled = false;
    $('app-feedback-send').disabled = false;
    if (!profile) { box.checked = false; $('app-feedback-message').textContent = 'Your Profile could not be read, so it is not included.'; }
  }
  drawPreview();
}

async function open() {
  $('app-feedback-message').textContent = '';
  const read = readScreenData();
  prepared = await window.pilot.feedbackPrepare(read.screen, read.data ? read : null).catch(() => ({...EMPTY}));
  $('app-feedback-include-shot').checked = !!prepared.shot;
  $('app-feedback-include-logs').checked = !!prepared.logs;
  $('app-feedback-include-logs').disabled = !prepared.logs;
  $('app-feedback-include-page').checked = !!prepared.page;   // on by default (owner, 2 Nov 2026)
  $('app-feedback-include-page').disabled = !prepared.page;
  $('app-feedback-page-note').textContent = prepared.page ? PAGE_NOTE : 'This screen has no data to send: Settings and your Profile are only sent through the snapshot below.';
  $('app-feedback-include-profile').checked = false;   // off by default, with its privacy note
  $('app-feedback-include-profile').disabled = false;
  const email = prepared.identity?.email || '';
  $('app-feedback-contact').value = email;
  $('app-feedback-contact-note').hidden = !email;
  drawShot();
  drawPreview();
  $('app-feedback-dialog').showModal();
  $('app-feedback-text').focus();
}

export async function init() {
  $('nav-feedback').addEventListener('click', open);
  window.pilot.onOpenFeedback(open);
  $('app-feedback-include-shot').addEventListener('change', drawShot);
  $('app-feedback-shot-remove').addEventListener('click', () => { $('app-feedback-include-shot').checked = false; drawShot(); });
  for (const id of ['page', 'logs']) $(`app-feedback-include-${id}`).addEventListener('change', drawPreview);
  $('app-feedback-include-profile').addEventListener('change', profileChanged);
  $('app-feedback-contact').addEventListener('input', drawPreview);
  $('app-feedback-send').addEventListener('click', async event => {
    event.preventDefault();
    const button = $('app-feedback-send');
    button.disabled = true;
    $('app-feedback-message').textContent = 'Sending…';
    const include = {screenshot: $('app-feedback-include-shot').checked, logs: $('app-feedback-include-logs').checked, page: $('app-feedback-include-page').checked, profile: $('app-feedback-include-profile').checked};
    const result = await window.pilot.sendFeedback($('app-feedback-text').value, $('app-feedback-contact').value, include)
      .catch(error => ({ok: false, error: error.message}));
    button.disabled = false;
    if (!result?.ok) { $('app-feedback-message').textContent = plainError(result?.error || 'Couldn\'t send it.'); return; }
    $('app-feedback-text').value = '';
    prepared = {...EMPTY};
    $('app-feedback-dialog').close();
    const left = result.skipped?.length ? ` (without the ${result.skipped.join(' and the ')}: too big)` : '';
    toastMessage('Thank you!', `Your feedback went straight to the maker${left}. If you left a contact, expect a reply.`, NO_PLACE.done, 'good');
  });
}
