// Send feedback (sidebar and Help → Send Feedback…): a note to the owner (lib/app-feedback.js → the website → the owner's Telegram). The user's own words; a contact only if they type one.
// Opening it first asks the main process for the window's picture (taken BEFORE this dialog draws over the app), the redacted logs and this screen's data (renderer/feedback-data.js);
// "See what's sent" shows the exact held text of every part that is ticked, plus what is always sent.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';
import {toastMessage} from './startup.js';
import {NO_PLACE} from '../targets.js';
import {plainError} from '../run-warnings.js';
import {readScreenData} from '../feedback-data.js';
import {countLine} from '../feedback-count.js';
import './feedback-screens.js';   // registers each page's data
import {drawTester, readTester} from './app-feedback-tester.js';

let prepared = {shot: null, logs: null, page: null, profile: null, identity: null, tester: null};
const PAGE_NOTE = t('pagesAuditFirst.a29');
const EMPTY = {shot: null, logs: null, page: null, profile: null, identity: null, tester: null};

// One state: the checkbox. The thumbnail shows while it is on and a picture exists; the × turns it off.
function drawShot() {
  const on = $('app-feedback-include-shot').checked && !!prepared.shot;
  $('app-feedback-shot').hidden = !on;
  if (on) $('app-feedback-shot-img').src = prepared.shot.dataUrl;
  $('app-feedback-include-shot').disabled = !prepared.shot;
  $('app-feedback-shot-note').textContent = prepared.shot ? t('pagesActivityMore.windowOnly')
    : t('pagesActivityMore.captureFailed');
}

// "See what's sent": what is always sent, then each ticked part's exact text. One state: the checkboxes plus what the main process holds.
function drawPreview() {
  const id = prepared.identity, contact = $('app-feedback-contact').value.trim();
  const sections = [['Always sent', [`app version: ${id?.version || '-'}`, `system: ${id?.platform || '-'}`, `install id: ${id?.install || '-'}`, `contact: ${contact || 'none'}`, 'your feedback text'].join('\n')]];
  if ($('app-feedback-include-page').checked && prepared.page) sections.push(["This screen's data", prepared.page.text]);
  if ($('app-feedback-include-profile').checked) sections.push(['Profile snapshot', prepared.profile ? prepared.profile.text : t('pagesCommon.readingProfile')]);
  if ($('app-feedback-include-logs').checked && prepared.logs) sections.push(['Logs', prepared.logs.text]);
  $('app-feedback-logs').textContent = sections.map(([title, text]) => `===== ${title} =====\n${text}`).join('\n\n');
}

// Design (Gitar on #3021, 3 Nov 2026; the third race in this read): the main process holds the one snapshot, for the dialog that asked (feedback-handlers.js `mine`); this page only mirrors it
// for the SAME dialog. Each open() makes a new `prepared`, so a read that finishes after the dialog was closed and reopened (asked !== prepared) is dropped: it neither fills the
// new dialog's mirror (main would not hold it) nor touches its switch or its Send button, which the new open() has already reset. Send is off only while this dialog's read runs.
async function profileChanged() {
  const box = $('app-feedback-include-profile');
  if (box.checked && !prepared.profile) {
    const asked = prepared;
    box.disabled = true;
    $('app-feedback-send').disabled = true;   // Why (Gitar on #3021): a Send during the read would leave the snapshot out without saying so
    drawPreview();
    const {profile} = await window.pilot.feedbackProfile().catch(() => ({profile: null}));
    if (asked !== prepared) return;
    prepared.profile = profile;
    box.disabled = false;
    $('app-feedback-send').disabled = false;
    if (!profile) { box.checked = false; $('app-feedback-message').textContent = t('pagesActivityMore.profileExcluded'); }
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
  $('app-feedback-page-note').textContent = prepared.page ? PAGE_NOTE : t('pagesActivityMore.noScreenData');
  $('app-feedback-include-profile').checked = false;   // off by default, with its privacy note
  $('app-feedback-include-profile').disabled = false;
  $('app-feedback-send').disabled = false;   // a read left pending by the last dialog never holds this one
  const email = prepared.identity?.email || '';
  $('app-feedback-contact').value = email;
  $('app-feedback-contact-note').hidden = !email;
  drawShot();
  drawPreview();
  drawTester(prepared.tester);   // only an AI tester app is told; a person's dialog is unchanged
  drawCount();   // derived from the box's current value: a reopened dialog keeps its text
  $('app-feedback-dialog').showModal();
  $('app-feedback-text').focus();
}

// The count is said only near the end (80% of the box's maxlength) and at it: a short note shows nothing (countLine). Why (4 Nov 2026): the box cut text with no word at all.
// Not a live region: it would read every keystroke past 6,400 (code review, 4 Nov 2026).
function drawCount() {
  const line = $('app-feedback-count'), text = countLine($('app-feedback-text').value.length, Number($('app-feedback-text').maxLength));
  line.hidden = !text;
  line.textContent = text;
}

export async function init() {
  $('app-feedback-text').addEventListener('input', drawCount);
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
    $('app-feedback-message').textContent = t('pagesStatus.sendingEllipsis');
    if (prepared.tester) {   // an AI tester files one bug bundle (lib/tester-bundle.js), never a note to the maker
      const filed = await window.pilot.sendTesterBug(readTester()).catch(error => ({ok: false, error: error.message}));
      button.disabled = false;
      if (!filed?.ok) { $('app-feedback-message').textContent = plainError(filed?.error || 'The bundle was not stored.'); return; }
      $('app-feedback-text').value = '';
      drawTester(prepared.tester);   // clear this bug's report before the next bundle is opened
      prepared = {...EMPTY};
      $('app-feedback-dialog').close();
      toastMessage('Bug filed', `Bundle ${filed.id}: ${filed.url}`, NO_PLACE.done, 'good');
      return;
    }
    const include = {screenshot: $('app-feedback-include-shot').checked, logs: $('app-feedback-include-logs').checked, page: $('app-feedback-include-page').checked, profile: $('app-feedback-include-profile').checked};
    const result = await window.pilot.sendFeedback($('app-feedback-text').value, $('app-feedback-contact').value, include)
      .catch(error => ({ok: false, error: error.message}));
    button.disabled = false;
    if (!result?.ok) { $('app-feedback-message').textContent = plainError(result?.error || t('pagesStatus.notSent')); return; }
    $('app-feedback-text').value = '';
    drawCount();
    prepared = {...EMPTY};
    $('app-feedback-dialog').close();
    const left = result.skipped?.length ? t('pagesDynamicSetup.m61', {"value1": result.skipped.join(t('pagesAuditFirst.a30'))}) : '';
    toastMessage(t('pagesCommon.thanks'), t('pagesDynamicSetup.m62', {"left": left}), NO_PLACE.done, 'good');
  });
}
