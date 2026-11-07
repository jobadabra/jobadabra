// Focus → "Did the interview happen?" (src/focus.py 'happened': its time passed and nothing was recorded).
// Yes: your notes become a 🎤 Interviews row, the job moves on, and a few lines get Claude's review (on this Mac, or on
// GitHub when Always on). No: moved to a new date (Next interview) or cancelled (an event; the stage stays).
import {date as displayDate} from '../../i18n/format.js';
import '../../i18n/screens-pages.js';
import {stageName} from './page-labels.js';
import {t} from '../../i18n/index.js';
import {aiName} from '../ai-name.js';
import {$, aiReady, message, show} from './core.js';
import {loadFocus} from './focus.js';
import {loadJobs} from './jobs.js';
import {toastMessage} from './startup.js';
import {storeName} from '../store-words.js';

let current = null;  // {item, answer: 'yes' | 'no'}
const who = item => item.company || item.via || 'the recruiter';

export function openHappened(item, answer) {
  current = {item, answer};
  const at = item.at ? new Date(item.at) : null;
  $('happened-title').textContent = answer === 'yes' ? t('pagesInterviews.howWent') : t('pagesInterviews.notHappened');
  $('happened-context').textContent = `${who(item)} · ${item.job || t('pagesCommon.interview')}${at ? ` · ${displayDate(at, {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}` : ''}`;
  show($('happened-yes'), answer === 'yes');
  show($('happened-no'), answer !== 'yes');
  $('happened-notes').value = '';
  $('happened-at').value = '';
  $('happened-save').disabled = false;
  message('happened-message', '');
  $('happened-dialog').showModal();
  (answer === 'yes' ? $('happened-notes') : $('happened-at')).focus();
}

// A few lines of notes: Claude reviews them like a transcript (the same review as a recording), in the background.
async function review(pageId, item) {
  if (!aiReady()) {
    toastMessage(t('pagesCommon.saved'), t('pagesInterviews.chooseAiNotes'), {card: 'ai'}, 'good');
    return;
  }
  toastMessage(t('pagesCommon.saved'), t('pagesDynamicFocusInterviews.m186', {"aiName": aiName(), "who": who(item)}), {view: 'interviews'}, 'good');
  const result = await window.pilot.interviews.review(pageId).catch(error => ({ok: false, error: error.message}));
  toastMessage(result.ok ? t('pagesInterviews.reviewed') : t('pagesInterviews.reviewFailed'), result.ok ? result.summary : result.error || t('pagesInterviews.tryInterviews'), {view: 'interviews'}, result.ok ? 'good' : 'bad');
  loadFocus();
  loadJobs();
}

async function save() {
  const {item, answer} = current;
  let detail = {};
  let kind = 'held';
  if (answer === 'yes') detail = {notes: $('happened-notes').value.trim()};
  else {
    kind = document.querySelector('input[name="happened-why"]:checked')?.value || 'moved';
    if (kind === 'moved') {
      const value = $('happened-at').value;
      if (!value) { message('happened-message', t('pagesInterviews.reschedule'), 'warn'); return false; }
      detail = {at: new Date(value).toISOString()};
    }
  }
  $('happened-save').disabled = true;
  const result = await window.pilot.interviewHappened(item.page_id, kind, detail).catch(error => ({ok: false, error: error.message}));
  $('happened-save').disabled = false;
  if (!result.ok) { message('happened-message', result.error || t('pagesDynamicFocusInterviews.m187', {"storeName": storeName()}), 'warn'); return false; }
  $('happened-dialog').close();
  if (kind === 'held' && result.review && result.id) review(result.id, item);
  else toastMessage(t('pagesCommon.saved'), {held: t('pagesDynamicFocusInterviews.m188', {"who": who(item), "value2": result.stage ? t('pagesDynamicFocusInterviews.nowStage', {stage: stageName(result.stage)}) : ''}),
    moved: t('pagesDynamicFocusInterviews.m189', {"who": who(item)}), cancelled: t('pagesDynamicFocusInterviews.m190', {"who": who(item)})}[kind], {view: 'interviews'}, 'good');
  loadFocus();
  loadJobs();
  return true;
}

// Give up on an interview (Up next ⋯, or the ✕ on a calendar event): after a confirmation, an "Interview cancelled" event
// in Notion and the Next interview cleared; the job's stage stays. onConfirmed runs as soon as the user says yes, onDone once Notion has it, onFail if it refused.
export async function dismissInterview({page_id, company, via}, {onConfirmed = () => {}, onDone = () => {}, onFail = () => {}} = {}) {
  const name = company || via || 'this recruiter';
  if (!confirm(t('pagesDynamicFocusInterviews.m191', {"name": name, "storeName": storeName()}))) return false;
  onConfirmed();   // the row leaves the list at once; Notion takes seconds
  const result = await window.pilot.interviewHappened(page_id, 'cancelled', {}).catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { onFail(); toastMessage(t('pagesCommon.notSaved'), result.error || t('pagesDynamicFocusInterviews.m192', {"storeName": storeName()}), {view: 'interviews'}, 'bad'); return false; }
  toastMessage(t('pagesInterviews.dismissed'), t('pagesDynamicFocusInterviews.m193', {"name": name}), {view: 'interviews'}, 'good');
  onDone();
  loadFocus();
  loadJobs();
  return true;
}

export function init() {
  $('happened-at').addEventListener('focus', () => { document.querySelector('input[name="happened-why"][value="moved"]').checked = true; });
  $('happened-save').addEventListener('click', event => { event.preventDefault(); save(); });
}
