// A replaced CV and what follows it.
import {date as displayDate} from '../../i18n/format.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {ai} from '../ai-name.js';
import {costText, dollars} from '../ai-cost.js';
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, message, show} from './core.js';
import {showOnTab} from './tab-part.js';
import {loadCvSetting} from './profile.js';
import {byStore} from '../store-words.js';
import {sayRefused} from './startup.js';
import {jobPlace} from '../targets.js';

// ---------- a replaced CV: what follows it (suggested Profile edits, tailoring base, unsent kits), never a rebuild ----------
let cvSuggestions = [];
const KITS_SHOWN = 3;
// The verdict banner and the status pills on the dialog's rows.
function setVerdict(tone, title, text) {
  const box = $('cv-verdict');
  box.className = `alert tone-${tone} cv-verdict`;
  box.firstElementChild.replaceWith(icon(tone === 'good' ? 'check-circle' : 'info'));
  $('cv-verdict-title').textContent = title;
  $('cv-verdict-text').replaceChildren(...text.split('\n').flatMap((line, i) => (i ? [document.createElement('br'), line] : [line])));
  show(box, true);
  show($('cv-profile-text'), false);
}
function setPill(id, text, tone) { $(id).replaceChildren(pill(text, tone)); }
export async function showCvChanged() {
  const change = await window.pilot.cvChange();
  $('cv-changed-text').textContent = t('pagesDynamicCvData.m105', {"value1": change.at ? t('pagesDynamicCvData.onDate', {when: displayDate(new Date(change.at))}) : ''});
  showOnTab($('cv-changed'), !!change.at);
  show($('strategy-cv-changed'), !!change.at);
}
export async function openCvChange() {
  const change = await window.pilot.cvChange();
  // What applying Profile edits does: every scored job is marked Old score until the person re-scores it (Find jobs never re-scores a listed job).
  $('cv-impact').textContent = '';
  show($('cv-impact'), false);
  window.pilot.strategyData().then(data => {
    if (!data?.ok || !data.scored) return;
    $('cv-impact').textContent = t('pagesDynamicCvData.m106', {"scored": data.scored}) +
      `${data.counts?.kits ? t('pagesDynamicCvData.m107', {"kits": data.counts.kits}) : ''}.`;
  }).catch(() => {});
  $('cv-dialog-name').textContent = change.name || t('pagesFinalCopy.yourCv');
  $('cv-dialog-sub').textContent = change.previous === change.name ? t('pagesLettersData.newSameName') : t('pagesDynamicCvData.m108', {"value1": change.previous ? t('pagesDynamicCvData.replaces', {name: change.previous}) : ''});
  show($('cv-verdict'), false);
  show($('cv-profile-text'), true);
  $('cv-profile-status').textContent = t('pagesProfile.notCompared');
  $('cv-compare').textContent = t('pagesProfile.compareProfile');
  show($('cv-cost'), true);
  setPill('cv-profile-pill', t('pagesFieldsStatus.notCompared'), 'neutral');
  $('cv-suggestions').replaceChildren();
  show($('cv-apply-row'), false);
  show($('cv-profile-status').parentElement, true);
  message('cv-review-message', '');
  $('cv-compare').disabled = !change.comparable;
  if (!change.comparable) {
    $('cv-profile-text').textContent = t('pagesDynamicCvData.m109', {"byStore": byStore(t('pagesProfile.editNotion'), t('pagesProfile.editProfile'))});
    show($('cv-profile-status').parentElement, false);
    setPill('cv-profile-pill', t('pagesFieldsStatus.editNotion'), 'neutral');
  }
  $('cv-base-text').textContent = change.base ? t('pagesLettersData.oldCvVersion') : t('pagesLettersData.firstTailorRead');
  setPill('cv-base-pill', change.base ? t('pagesFieldsStatus.toUpdate') : t('pagesFieldsStatus.nothingDo'), change.base ? 'warn' : 'neutral');
  show($('cv-base-actions'), change.base);
  const kits = shared.allJobs.filter(job => job.kit && job.code && job.status !== 'applied' && job.status !== 'dismissed');
  let showAll = false;
  const draw = () => {
    const shown = showAll ? kits : kits.slice(0, KITS_SHOWN);
    $('cv-kits').replaceChildren(...shown.map(job => {
      const row = el('div', 'cv-kit');
      const redraft = el('button', 'ghost with-icon', t('pagesProfile.redraft'));
      redraft.prepend(icon('refresh'));
      redraft.addEventListener('click', async () => {
        redraft.disabled = true;
        redraft.textContent = t('pagesProfile.redrafting');
        const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
        redraft.textContent = result.ok ? t('pagesProfile.redrafted') : t('pagesCommon.retry');
        sayRefused(t('pagesFieldsStatus.redraftNotStarted'), result, {place: jobPlace(job)});   // no AI credit, trial over (renderer/refusal.js): why, not a bare Retry
        redraft.disabled = !!result.ok;
      });
      const name = el('div');
      name.append(el('b', '', job.title), el('span', 'muted small', job.company));
      row.append(name, redraft);
      return row;
    }));
    const more = $('cv-kits-more');
    show(more, kits.length > KITS_SHOWN);
    more.textContent = showAll ? t('pagesProfile.showFewer') : t('pagesDynamicCvData.m110', {"length": kits.length});
  };
  $('cv-kits-more').onclick = () => { showAll = !showAll; draw(); };
  $('cv-kits-count').textContent = String(kits.length);
  draw();
  show($('cv-kits-row'), kits.length > 0);
  if (!$('cv-dialog').open) $('cv-dialog').showModal();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('cv-changed-open').addEventListener('click', openCvChange);
  $('cv-compare').addEventListener('click', async () => {
    const button = $('cv-compare');
    button.disabled = true;
    button.classList.add('busy');
    message('cv-review-message', ai(t('pagesAuditPunct.a15')), 'waiting');
    const result = await window.pilot.cvReview();
    button.disabled = false;
    button.classList.remove('busy');
    if (!result.ok) return message('cv-review-message', result.error, 'error');
    cvSuggestions = result.suggestions;
    message('cv-review-message', '');
    $('cv-profile-status').textContent = t('pagesDynamicCvData.m111', {"costText": costText(result.usd, usd => t('pagesDynamicCvData.m112', {"dollars": dollars(usd)}))});
    $('cv-compare').textContent = t('pagesProfile.compareAgain');
    show($('cv-impact'), cvSuggestions.length > 0);   // what applying costs matters only when there is something to apply
    if (cvSuggestions.length) {
      setVerdict('info', t('pagesDynamicCvData.m113', {"length": cvSuggestions.length, count: cvSuggestions.length}), t('pagesDynamicCvData.m114', {"summary": result.summary}));
      setPill('cv-profile-pill', t('pagesDynamicCvData.m115', {"length": cvSuggestions.length}), 'warn');
    } else {
      setVerdict('good', t('pagesFieldsStatus.noProfileEdits'), t('pagesAuditPunct.a16'));
      setPill('cv-profile-pill', t('pagesFieldsStatus.unchanged'), 'neutral');
    }
    const label = {update: [t('pagesCommon.update'), 'info'], add: [t('pagesCommon.add'), 'good'], remove: [t('pagesCommon.remove'), 'bad']};
    $('cv-suggestions').replaceChildren(...cvSuggestions.map(s => {
      const row = el('label', 'radio cv-suggestion inline-label');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = s.kind !== 'remove';  // removals are opt-in
      box.dataset.id = s.id;
      const body = el('span');
      body.append(pill(label[s.kind][0], label[s.kind][1]), ' ');
      if (s.kind !== 'add') body.append(el('s', 'muted', s.block.text), s.kind === 'update' ? ' → ' : '');
      if (s.kind !== 'remove') body.append(el('b', '', s.text));
      if (s.kind === 'add') body.append(el('span', 'muted', t('pagesShortActivity.m101', {"value1": s.block.text.slice(0, 60)})));
      body.append(el('div', 'muted small', s.why));
      row.append(box, body);
      return row;
    }));
    show($('cv-apply-row'), cvSuggestions.length > 0);
  });
  $('cv-apply').addEventListener('click', async () => {
    const picked = new Set([...$('cv-suggestions').querySelectorAll('input:checked')].map(box => Number(box.dataset.id)));
    const accepted = cvSuggestions.filter(s => picked.has(s.id));
    if (!accepted.length) return message('cv-review-message', t('pagesProfile.nothingSelected'), 'waiting');
    $('cv-apply').disabled = true;
    const result = await window.pilot.cvApply(accepted);
    $('cv-apply').disabled = false;
    if (!result.ok) return message('cv-review-message', result.error, 'error');
    message('cv-review-message', result.failed.length ? t('pagesDynamicCvData.m116', {"applied": result.applied, "value2": result.failed.join('; ')})
      : t('pagesDynamicCvData.m117', {"applied": result.applied, "byStore": byStore(t('pagesDynamicCvData.inNotion'), ''), count: result.applied}), result.failed.length ? 'error' : 'ok');
    if (!result.failed.length) { $('cv-suggestions').replaceChildren(); show($('cv-apply-row'), false); setPill('cv-profile-pill', '✓ Updated', 'good'); setVerdict('good', t('pagesFieldsStatus.profileUpdated'), byStore(t('pagesAuditFirst.a50'), t('pagesAuditFirst.a51'))); }
  });
  $('cv-base-read').addEventListener('click', async () => {
    const button = $('cv-base-read');
    button.disabled = true;
    button.textContent = t('pagesProfile.readingCv');
    const result = await window.pilot.importCv();
    button.textContent = result.ok ? t('pagesShortActivity.m102', {"costText": costText(result.usd, usd => ` (${dollars(usd)})`)}) : t('pagesCommon.retry');
    button.disabled = !!result.ok;
    if (result.ok) setPill('cv-base-pill', '✓ Updated', 'good');
    loadCvSetting();
  });
  $('cv-later').addEventListener('click', () => { $('cv-dialog').close(); showCvChanged(); });
  $('cv-done').addEventListener('click', async () => { await window.pilot.cvChangeDone(); $('cv-dialog').close(); showCvChanged(); });
}
