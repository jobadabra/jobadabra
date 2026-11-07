// Optional language dropdown on Welcome and a saved display preference in Settings → Overview.
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

/** Mount optional Welcome and Overview language selectors without adding a wizard step or card. */
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
  const welcome = document.querySelector('.step[data-step="welcome"] .magic');
  if (!welcome || document.getElementById('wizard-language-choice')) return;
  const row = el('div', 'welcome-language');
  const {label, select} = selector('wizard-language-choice', state.choice);
  const message = el('p', 'message'); message.setAttribute('role', 'status');
  row.append(label, select); welcome.prepend(row); row.after(message);
  select.addEventListener('change', () => applyChoice(select, message, state, pilot));
}
