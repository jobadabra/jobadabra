// Fill now's popup (owner, 19 Oct 2026: "a popup asking for the number"; sketch approved the same day): the choice 1 / 3 / 5 / 10 (default 3) as the app's segmented control,
// the top jobs it would take with what each still needs, and the cost of making it, before any AI is spent. The answer is the promise's: {codes, prepare} or null. Guard: test/unit/renderer/ready-card.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el, pill} from '../components.js';
import {icon} from '../icons.js';

// top: the readyTop answer {picked: [{code, name, needsKit, needsCv}], chips, lines: {count: costLine}}. -> Promise<{codes: [...], prepare: boolean} | null>
export function pickFill(top, {start = 3} = {}) {
  return new Promise(resolve => {
    const chips = top.chips?.length ? top.chips : [1, 3, 5, 10], dialog = el('dialog', 'save-dialog panel-dialog cv-dialog ready-confirm ready-pick');
    dialog.id = 'ready-pick';
    let count = chips.includes(start) ? start : chips[0];
    const head = el('div', 'dialog-head'), lead = el('div', 'cv-head'), tile = el('span', 'dialog-icon');
    tile.append(icon('moon'));
    lead.append(el('h2', '', t('pagesDetails.fillCount')), el('p', 'muted', t('pagesDetails.bestFirst')));
    const close = el('button', 'ghost icon-btn', '');
    close.id = 'ready-pick-close'; close.type = 'button'; close.setAttribute('aria-label', t('pagesCommon.close')); close.append(icon('close'));
    head.append(tile, lead, close);
    const group = el('div', 'segmented'), list = el('ul', 'ready-confirm-list'), cost = el('p', 'muted ready-pick-cost');
    const foot = el('div', 'dialog-foot'), buttons = el('span', 'inline');
    const no = el('button', 'secondary', t('pagesCommon.cancel')), yes = el('button', 'primary', t('pagesCommon.fillNow'));
    no.id = 'ready-pick-no'; yes.id = 'ready-pick-yes'; no.type = yes.type = 'button';
    const paint = () => {
      const shown = top.picked.slice(0, count), prepare = shown.some(job => job.needsKit || job.needsCv);
      for (const button of group.children) button.classList.toggle('is-active', Number(button.dataset.count) === count);
      list.replaceChildren(...shown.map(job => {
        const item = el('li', '', job.name || job.code);
        item.append(' ', pill(job.needsKit ? t('pagesDetails.needsKit') : job.needsCv ? t('pagesDetails.needsCv') : t('pagesDetails.readyLower'), job.needsKit || job.needsCv ? 'warn' : 'good'));
        return item;
      }));
      cost.textContent = top.lines?.[count] || '';
      yes.textContent = prepare ? t('pagesCommon.prepareFill') : t('pagesCommon.fillNow');
      yes.disabled = !shown.length;
    };
    for (const each of chips) {
      const button = el('button', '', String(each));
      button.type = 'button'; button.dataset.count = String(each);
      button.addEventListener('click', () => { count = each; paint(); });
      group.append(button);
    }
    buttons.append(no, yes);
    foot.append(el('span', 'muted small', t('pagesCommon.nothingSubmitted')), buttons);
    dialog.append(head, group, list, cost, foot);
    let answered = false;
    const answer = value => { if (answered) return; answered = true; if (dialog.open) dialog.close?.(); dialog.remove(); resolve(value); };
    dialog.addEventListener('close', () => answer(null));
    close.addEventListener('click', () => answer(null));
    no.addEventListener('click', () => answer(null));
    yes.addEventListener('click', () => answer({codes: top.picked.slice(0, count).map(job => job.code), prepare: top.picked.slice(0, count).some(job => job.needsKit || job.needsCv)}));
    paint();
    document.body.append(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  });
}
