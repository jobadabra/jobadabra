import {finalText} from '../final-pages-copy.js';
// Interviews page, the job list helpers (names, the picker's options, the pasted link), the unsaved-recordings list and
// the speaker-name fields. Moved out of interviews.js, which passes in the open draft and what to do with it.
// Guarded by test/unit/main/interviews.test.js, test/unit/renderer/interview-library.test.js and test/unit/renderer/review-again.test.js.
import {date as displayDate} from '../../i18n/format.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el, moreButton, pill, tile} from '../components.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {byStore} from '../store-words.js';
import {jobOfApplication} from '../jobs-view.js';

const iv = window.pilot.interviews;
export const plainId = id => String(id || '').replace(/-/g, '');
export const jobList = () => (Array.isArray(shared.allJobs) ? shared.allJobs : []);  // unset while the job list loads
export const jobName = job => job.status === 'applied' ? finalText('appliedSuffix', {job: `${job.company} — ${job.title}`}) : `${job.company} — ${job.title}`;
// An interview's job: by the store's id (job.page_id, every store) or its Notion page (renderer/jobs-view.js jobOfApplication).
export const jobForPage = pageId => jobOfApplication(jobList(), pageId);

// Every job in the list (applied and tracked ones first); one not in Applications yet is added there on save.
export const PASTE = '__paste__';
export function jobOptions(select, chosenUrl, emptyLabel) {
  const rank = job => (job.status === 'applied' ? 0 : job.notion_url || job.page_id ? 1 : 2);   // tracked first, on any store
  const jobs = jobList().filter(job => job.url && job.status !== 'dismissed')
    .sort((a, b) => rank(a) - rank(b) || a.company.localeCompare(b.company));
  select.replaceChildren(new Option(emptyLabel, ''), ...jobs.map(job => new Option(jobName(job), job.url, false, job.url === chosenUrl)));
  if (chosenUrl && !jobs.some(job => job.url === chosenUrl)) select.append(new Option(chosenUrl, chosenUrl, false, true));
  select.append(new Option(t('pagesFinalLabels.pasteJob'), PASTE));
}
export const jobUrlOf = (select, input) => (select.value === PASTE ? (/^https?:\/\//.test(input.value.trim()) ? input.value.trim() : '') : select.value);


export function renderDrafts(drafts, env) {
  show($('iv-drafts-block'), drafts.length > 0);
  $('iv-unsaved').textContent = t('pagesShortJobs.m147', {"length": drafts.length});
  // Status: words for the meta line, and a pill.
  const STATUS = {new: t('pagesControlStatus.notTranscribed'), recording: t('pagesControlStatus.recordingDots'), transcribing: t('pagesControlStatus.transcribingDots'), stopped: t('pagesControlStatus.stoppedTranscribe'),
    failed: t('pagesCommon.failed'), ready: t('pagesControlStatus.transcriptReady')};
  const PILL = {ready: ['good', t('pagesCommon.ready')], transcribing: ['signal', t('pagesControlStatus.transcribing')], recording: ['signal', t('pagesControlStatus.recording')], failed: ['bad', t('pagesCommon.failed')]};
  $('iv-drafts').replaceChildren(...drafts.map(draft => {
    const busy = draft.status === 'recording' || draft.status === 'transcribing';
    const row = el('div', `iv-draft${draft.id === env.openId() ? ' open' : ''}`);
    const text = el('div', 'iv-draft-text');
    const when = displayDate(new Date(draft.createdAt), {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    const meta = el('div', 'muted small');
    const parts = [when, draft.seconds ? t('pagesShortJobs.m149', {"value1": Math.max(1, Math.round(draft.seconds / 60))}) : '', STATUS[draft.status] || draft.status,
      draft.pageUrl ? t('pagesControlStatus.transcriptNotion') : t('pagesControlStatus.storedLocal')].filter(Boolean);   // about Notion
    meta.textContent = parts.join('  ·  ');
    text.append(el('b', '', draft.title), meta);
    const [tone, label] = PILL[draft.status] || ['neutral', STATUS[draft.status] || draft.status];
    const state = pill(label, tone, {dot: true});
    // The next step for this draft: transcribe it, or review the transcript and save it.
    const needsTranscript = draft.kind === 'audio' && ['new', 'stopped', 'failed'].includes(draft.status);
    const main = Object.assign(el('button', 'primary iv-main', draft.status === 'ready' ? t('pagesJobs.reviewSave') : needsTranscript ? t('pagesJobs.transcribe') : t('pagesCommon.open')),
      {disabled: busy && draft.id !== env.openId()});
    main.addEventListener('click', () => env.openDraft(draft.id));
    const menu = [{label: t('pagesCommon.open'), run: () => env.openDraft(draft.id)}];
    if (draft.pageUrl) menu.push({label: t('pagesInterviews.transcriptNotion'), run: () => window.pilot.openExternal(draft.pageUrl)});
    // Saved with the data on this Mac (no page to open): the saved transcript and its review in the app (interview-review-view.js).
    else if (draft.pageId && env.openReview) menu.push({label: t('pagesInterviews.transcriptReview'), run: () => env.openReview(draft.pageId)});
    menu.push({label: t('pagesFieldsStatus.showFinder'), run: () => iv.recordings(), title: t('pagesInterviews.recordingsLocal')});
    if (!busy) {
      menu.push('-', {label: draft.pageId ? byStore(t('pagesInterviews.deleteBoth'), t('pagesCommon.delete')) : t('pagesJobs.deleteRecording'), danger: true, run: async () => {
        if (!confirm(draft.pageId ? t('pagesShortJobs.m150', {"title": draft.title, "byStore": byStore(t('pagesAuditSecond.a92'), '')}) : t('pagesDynamicFocusInterviews.m195', {"title": draft.title}))) return;
        await iv.discard(draft.id);
        if (env.openId() === draft.id) env.closeEditor();
        renderDrafts(await iv.drafts(), env);
      }});
    }
    const actions = el('div', 'row-actions');
    actions.append(main, moreButton(menu, t('pagesInterviews.recordingMenu')));
    row.append(tile(draft.kind === 'audio' ? 'mic' : 'file'), text, state, actions);
    return row;
  }));
}

// One field per speaker; renaming rewrites every "[time] Name:" line of the transcript.
export function renderSpeakers(onRename) {
  const names = [...new Set([...$('iv-text').value.matchAll(/^\[\d\d:\d\d:\d\d\] ([^:\n]{1,60}):/gm)].map(m => m[1]))];
  $('iv-speakers').replaceChildren(...names.map(name => {
    const label = Object.assign(document.createElement('label'), {textContent: name});
    const input = Object.assign(document.createElement('input'), {value: name, placeholder: t('pagesInterviews.speakersExample')});
    input.addEventListener('change', () => {
      const to = input.value.replace(/[:\n[\]]/g, ' ').trim();
      if (!to || to === name) { input.value = name; return; }
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      $('iv-text').value = $('iv-text').value.replace(new RegExp(`^(\\[\\d\\d:\\d\\d:\\d\\d\\] )${escaped}:`, 'gm'), `$1${to}:`);
      onRename();
      renderSpeakers(onRename);
    });
    label.append(input);
    return label;
  }));
}
