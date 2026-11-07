// Fill now's yes (owner, 18 Oct 2026: filling again a job you opened "should be possible, but with a confirmation popup"): the app's dialog parts (the head, icon and close of the
// Watch the fill popup) with what would be filled and what it replaces; the answer is the promise's. Escape or × is a no. Guard: test/unit/renderer/ready-card.test.js.
import '../../i18n/screens-pages.js';
import {counted} from './page-counts.js';
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {icon} from '../icons.js';

// ask: {again, jobs: [{code, name}], replaces, note?}. -> Promise<boolean>
export function confirmFill(ask) {
  return new Promise(resolve => {
    const dialog = el('dialog', 'save-dialog panel-dialog cv-dialog ready-confirm');
    dialog.id = 'ready-confirm';
    const head = el('div', 'dialog-head'), lead = el('div', 'cv-head'), tile = el('span', 'dialog-icon');
    tile.append(icon('moon'));
    const n = ask.jobs.length, forms = count => counted('form', count);
    lead.append(el('h2', '', ask.again ? t('pagesDynamicProfileReady.fillAgain', {count: n}) : t('pagesDynamicProfileReady.fillNow', {forms: forms(n)})),
      el('p', 'muted', ask.again ? t('pagesDynamicProfileReady.m311', {count: n}) : t('pagesReadyReports.serverNow')));
    const close = el('button', 'ghost icon-btn', '');
    close.id = 'ready-confirm-close'; close.type = 'button'; close.setAttribute('aria-label', t('pagesCommon.close'));
    close.append(icon('close'));
    head.append(tile, lead, close);
    const list = el('ul', 'ready-confirm-list');
    for (const job of ask.jobs) list.append(el('li', '', job.name || job.code));
    const parts = [head, list];
    if (ask.note) parts.push(el('p', 'muted', ask.note));
    if (ask.replaces) parts.push(el('p', 'message', t('pagesDynamicProfileReady.m312', {"forms": forms(ask.replaces), count: ask.replaces})));
    const foot = el('div', 'dialog-foot'), buttons = el('span', 'inline');
    const no = el('button', 'secondary', t('pagesCommon.cancel')), yes = el('button', 'primary', ask.again ? t('pagesReadyReports.fillAgain') : t('pagesCommon.fillNow'));
    no.id = 'ready-confirm-no'; yes.id = 'ready-confirm-yes'; no.type = yes.type = 'button';
    buttons.append(no, yes);
    foot.append(el('span', 'muted small', t('pagesCommon.nothingSubmitted')), buttons);
    dialog.append(...parts, foot);
    let answered = false;
    const answer = value => { if (answered) return; answered = true; if (dialog.open) dialog.close?.(); dialog.remove(); resolve(value); };
    dialog.addEventListener('close', () => answer(false));   // Escape
    close.addEventListener('click', () => answer(false));
    no.addEventListener('click', () => answer(false));
    yes.addEventListener('click', () => answer(true));
    document.body.append(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  });
}
