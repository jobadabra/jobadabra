// Session page, "Form completion" card and "Before you submit" box (knockout questions, which CV goes in).
// Moved out of session-needs.js, which calls showFormCard from showFormState. Guarded by test/unit/main/form-tab-closed.test.js
// and test/unit/renderer/need-proposal.test.js (npm test in desktop/).
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el, pill} from '../components.js';
import {accountCardOf, isSubmitted} from '../session-state.js';
import {KNOCKOUT} from '../knockout.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {openMatchCheck} from './match-check.js';
import {reasonFor} from '../reason-words.js';
import {formGone} from './session-needs.js';  // cycle by design: used inside functions only

// "Form completion", as on the website: where, "16 / 17 required fields" and the bar always; the fields folded under
// them: what's left first, then each filled one with its time since the fill started (the first field filled).
// "Before you submit": what decides an application more than the CV, from what the form says is still open. The knockout questions (a hiring system can be set to
// reject on them: private research jobadabra-lab:docs/research/ats-reddit-2026-10.md) and which CV goes in: the general one, or one tailored to this job, with a way to tailor it.
const fullKey = url => String(url || '').trim().replace(/\/$/, '');
let beforeRead = 0; // only the latest card draw may use an asynchronous letter/CV answer
const cvSeen = new Map();   // job url → {at, info}
async function cvInfo(url, given, failed) {
  const key = `${url}:${!!given}:${!!failed}`, known = cvSeen.get(key);
  if (known && Date.now() - known.at < 4000) return known.info;
  const info = await window.pilot.cvOf(url, !!given, !!failed).catch(() => null);
  cvSeen.set(key, {at: Date.now(), info});
  return info;
}
// A knockout: the English words, or the AI that read the form in any language (extension/page/categories.js -> the panel's `knockouts`).
function showBefore(item, left, account = false, aiKnockouts = [], letterGiven = false, letterAsked = false, letterFailed = false) {
  const read = ++beforeRead;
  const knockouts = left.filter(label => KNOCKOUT.test(label) || aiKnockouts.includes(label));
  const submitted = isSubmitted(item);
  show($('ss-before-knock'), !submitted && knockouts.length > 0);
  if (knockouts.length) {
    $('ss-before-knock-title').textContent = t('pagesDynamicSessionReports.m336', {"length": knockouts.length, count: knockouts.length});
    $('ss-before-knock-list').textContent = t('pagesShortSettings.m303', {"value2": knockouts.slice(0, 3).map(label => label.replace(/\s*\*\s*$/, '')).join(' · '), "value3": knockouts.length > 3 ? ' …' : '', count: knockouts.length});
  }
  const job = shared.allJobs.find(candidate => fullKey(candidate.url) === fullKey(item.url));
  show($('ss-before-cv'), false);
  show($('ss-before-letter'), false);
  // A sign-in or sign-up page is not the application: no CV goes there (owner, 8 Oct 2026).
  if (submitted || !item.url || account) return show($('ss-before'), !submitted && knockouts.length > 0);
  cvInfo(item.url, letterGiven, letterFailed).then(info => {
    if (!info || read !== beforeRead) return;
    const letter = info.coverLetterStatus;
    const letterMissing = letterAsked && letter && !letter.ready;
    show($('ss-before-letter'), !!letterMissing);
    if (letterMissing) {
      $('ss-before-letter-title').textContent = t('pagesSessionStates.priorityLetter');
      $('ss-before-letter-sub').textContent = letter.reason;
      $('ss-before-letter-btn').textContent = letter.action;
      $('ss-before-letter-btn').onclick = () => import('./settings.js').then(page => page.openSetting('letter'));
      $('ss-form-pill').replaceChildren(pill(t('pagesSessionStates.letterSetup'), 'warn'));
      $('ss-form-card').classList.remove('is-ready');
    }
    show($('ss-before-cv'), true);
    $('ss-before-cv-mark').textContent = info.tailored ? '✓' : '○';
    // Why (27 Oct 2026, owner): Localized display keys preserve this rule: the form's panel no longer tailors; its "Tailor in Jobadabra" opens this card, and a tailored CV restarts the form (lib/tailored-restart.js).
    $('ss-before-cv-title').textContent = info.tailored ? t('pagesSessionStates.tailoredReady') : info.working ? t('pagesSessionStates.tailoringJob') : job?.code ? t('pagesSessionStates.generalCv') : t('pagesSessionStates.jobNotListed');
    $('ss-before-cv-sub').textContent = info.tailored ? t('pagesSessionStates.fillAgainStart') : info.working ? t('pagesSessionStates.tailorTime')
      : job?.code ? t('pagesSessionStates.tailorReplies') : t('pagesSessionStates.addToTailor');
    const compare = $('ss-before-match-btn');
    show(compare, !!job?.code);
    compare.onclick = () => openMatchCheck(job);
    const button = $('ss-before-cv-btn');
    show(button, !info.tailored && !info.working);
    button.disabled = false;
    button.textContent = job?.code ? t('pagesSessionStates.tailorMyCv') : t('pagesSessionStates.addJob');
    button.onclick = async () => {
      button.disabled = true;
      if (!job?.code) {   // the panel's old "Add this job", now here: once the job is listed, the same button tailors
        button.textContent = t('pagesSessionStates.adding');
        const added = await window.pilot.importJob(String(item.url).split('#')[0]).catch(error => ({ok: false, text: error.message}));
        if (added?.ok) { try { const fresh = (await window.pilot.jobs()).jobs; if (Array.isArray(fresh)) shared.allJobs = fresh; } catch {} }
        button.textContent = added?.ok ? t('pagesSessionStates.tailorMyCv') : t('pagesCommon.retry');
        button.disabled = false;
        if (added?.ok) showBefore(item, left, account, aiKnockouts, letterGiven, letterAsked, letterFailed);
        else button.title = added?.text || '';
        return;
      }
      button.textContent = t('pagesSessionStates.tailoringTime');
      const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`, [job.url, item.url]);
      button.textContent = result.ok ? t('pagesSessionStates.tailored') : t('pagesCommon.retry');
      button.disabled = !!result.ok;
      for (const given of [false, true]) for (const failed of [false, true]) cvSeen.delete(`${item.url}:${given}:${failed}`);
      if (result.ok) showBefore(item, left, account, aiKnockouts, letterGiven, letterAsked, letterFailed);
    };
    show($('ss-before'), true);
  });
  show($('ss-before'), knockouts.length > 0);
}
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function showFormCard(item, state) {
  const card = $('ss-form-card');
  card.hidden = !state?.total || formGone(item);
  if (card.hidden) return;
  // A sign-in or sign-up page is the account step, not the application: its own title, count and what is left for you (never "Ready to submit").
  const account = accountCardOf(item, state);
  $('ss-form-title').textContent = account ? account.title : t('pagesSessionStates.formCompletion');
  const done = state.total - state.left;
  $('ss-form-pill').replaceChildren(account ? pill(account.pill.text, account.pill.tone, {dot: true, title: t('pagesSessionStates.accountStep')}) : isSubmitted(item) ? pill(t('pagesSession.submitted'), 'good', {dot: true})
    : state.ready ? pill(t('pagesSessionStates.readySubmit'), 'good', {dot: true})
    : state.needs && !state.left ? pill(t('pagesDynamicSessionReports.m337', {"value1": state.needs === '1' ? t('pagesSessionStates.seeForm') : state.needs}), 'warn', {title: t('pagesSessionStates.onlyYou')})   // the AI's veto (a consent link, a picklist the count cannot see)
    : pill(t('pagesShortSettings.m304', {"left": state.left}), 'warn', {title: t('pagesDynamicSessionReports.m338', {"value1": state.total - state.left, "total": state.total})}));
  const count = $('ss-form-count');
  count.replaceChildren(el('b', '', String(done)), el('span', '', account ? account.count : t('pagesDynamicSessionReports.m339', {"total": state.total})));
  $('ss-form-bar').style.width = `${Math.round(100 * done / state.total)}%`;
  card.classList.toggle('is-ready', !!state.ready);
  showBefore(item, state.pending || state.missing || [], !!state.account, state.knockouts || [], state.letterGiven === true, state.letterAsked === true, state.letterFailed === true);
  // An extension older than 0.8.12 sends no filled fields: then only what's left.
  const filled = [...(state.filled || [])].sort((a, b) => a.at - b.at);
  const left = account ? account.left : state.pending || state.missing || [];
  const start = filled.find(field => field.at)?.at || 0;
  $('ss-form-more').hidden = !filled.length && !left.length;
  const leftCount = Math.max(left.length, state.left);
  const leftText = leftCount ? t('pagesFinalCopy.remainingFields', {count: leftCount}) : '';
  $('ss-form-summary').textContent = filled.length ? t('pagesDynamicSessionReports.m340', {"length": filled.length, "value3": leftText ? t('pagesDynamicSessionReports.andFields', {fields: leftText}) : '', count: filled.length})
    : t('pagesDynamicSessionReports.m341', {"leftText": leftText});
  // Who filled it: you (after the fill was over) or the fill (Claude, the extension); the time only when the app saw it.
  const row = (kind, time, mark, label, by = '') => {
    const li = el('li', kind);
    const text = el('span', 'ss-form-label', label);
    text.title = label;
    li.append(el('span', 'ss-form-time', time), el('b', 'ss-form-mark', mark), text);
    if (by) li.append(el('span', 'ss-form-by', by));
    return li;
  };
  $('ss-form-fields').replaceChildren(
    ...left.map((label, index) => { const li = row('is-left', '', '○', label, account && index === 0 && state.needs ? t('pagesAuditThird.a179') : ''); li.title = reasonFor(state, label) || ''; return li; }),   // why the fill left it (reason-words.js)
    ...filled.map(field => row(field.by === 'you' ? 'is-filled is-yours' : 'is-filled', field.at ? clock(Math.max(0, field.at - start)) : '', '✓', field.label,
      field.by === 'you' ? 'you' : '')));
}
