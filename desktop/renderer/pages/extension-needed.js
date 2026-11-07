// Apply with no Chrome extension to fill the form (lib/extension-gate.js answers {needsExtension}; preload.cjs raises pilot-needs-extension):
// a dialog says why the extension is needed and what installing it takes, then leads to the install steps in Settings → Connections.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';
import {openSetting} from './settings.js';

const TITLE = {absent: t('pagesDetails.installFirst'), off: t('pagesDetails.enableFirst')};
const GO = {absent: t('pagesDetails.installExtension'), off: t('pagesDetails.showHow')};

export function init() {
  const dialog = $('extension-needed-dialog');
  window.addEventListener('pilot-needs-extension', event => {
    if (dialog.open) return;
    const state = event.detail?.state === 'off' ? 'off' : 'absent';
    $('extension-needed-title').textContent = TITLE[state];
    $('extension-needed-go').textContent = GO[state];
    dialog.showModal();
  });
  $('extension-needed-later').addEventListener('click', () => dialog.close());
  $('extension-needed-go').addEventListener('click', () => { dialog.close(); openSetting('extension'); });
}
