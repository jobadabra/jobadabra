// Language is the wizard's first question and a display preference in Settings → Overview.
import {SUPPORTED_LOCALES, LANGUAGE_NAMES, t} from '../../i18n/index.js';
import {el} from '../components.js';
import {anyUnsaved} from '../save-bar.js';
import {changeLanguage} from '../language-change.js';

function selector(id, choice) {
  const label = el('label', '', t('common.language'));
  label.htmlFor = id;
  const select = el('select');
  select.id = id;
  select.append(new Option(t('common.system'), 'system'));
  for (const locale of SUPPORTED_LOCALES) select.append(new Option(LANGUAGE_NAMES[locale], locale));
  select.value = choice;
  return {label, select};
}

async function applyChoice(select, message, state, pilot) {
  select.disabled = true;
  const result = await changeLanguage(select.value, {hasUnsaved: anyUnsaved, save: choice => pilot.setLocale(choice), reload: () => window.location.reload()});
  if (!result.ok) {
    select.value = state.choice;
    message.textContent = t(result.reason === 'unsaved' ? 'common.unsavedLanguage' : 'common.languageFailed');
    select.disabled = false;
  }
}

/** Mount the first wizard step and Overview selector before wizard initialization binds its sidebar. */
export function init(state, pilot = window.pilot) {
  const overview = document.querySelector('[data-settings-page="overview"]');
  if (overview && !document.getElementById('setting-language')) {
    const panel = el('div', 'setting panel'); panel.id = 'setting-language';
    const {label, select} = selector('settings-language', state.choice);
    const help = el('p', 'muted', t('common.languageHelp'));
    const message = el('p', 'message'); message.setAttribute('role', 'status');
    panel.append(label, select, help, message); overview.append(panel);
    select.addEventListener('change', () => applyChoice(select, message, state, pilot));
  }
  const body = document.querySelector('#wizard .step-body'), steps = document.getElementById('step-list');
  if (!body || !steps || document.getElementById('wizard-language')) return;
  const item = el('li', '', t('common.language')); item.dataset.step = 'language'; steps.prepend(item);
  const step = el('div', 'step'); step.dataset.step = 'language'; step.id = 'wizard-language'; step.hidden = true;
  const stage = el('div', 'magic-stage'), card = el('section', 'magic');
  const {label, select} = selector('wizard-language-choice', state.choice);
  const message = el('p', 'message'); message.setAttribute('role', 'status');
  const next = el('button', 'primary', t('common.continue')); next.type = 'button'; next.id = 'wizard-language-continue';
  card.append(el('h1', 'magic-title', t('common.chooseLanguage')), label, select, el('p', 'muted magic-sub', t('common.chooseHelp')), message, next);
  stage.append(card); step.append(stage); body.prepend(step);
  next.addEventListener('click', async () => {
    next.disabled = true;
    await applyChoice(select, message, state, pilot);
    next.disabled = false;
  });
}
