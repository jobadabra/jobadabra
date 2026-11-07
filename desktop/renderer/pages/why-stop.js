// Why setup stopped: asked once when quitting mid-setup ("Leaving setup?"), or any time from "Stuck? Tell us" in the
// wizard. The reason goes to the setup funnel (lib/setup-funnel.js); typed words also reach the owner.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';
import {toastMessage} from './startup.js';
import {NO_PLACE} from '../targets.js';

let mode = 'quit';

function open(asked) {
  mode = asked;
  const quit = mode === 'quit';
  $('why-title').textContent = quit ? t('pagesMisc.leavingSetup') : t('pagesMisc.stuck');
  $('why-lead').textContent = quit ? t('pagesMisc.oneTap')
    : t('pagesMisc.blockerFeedback');
  $('why-skip').textContent = quit ? t('pagesMisc.justQuit') : t('pagesCommon.cancel');
  $('why-send').textContent = quit ? t('pagesMisc.sendQuit') : t('pagesSession.send');
  document.querySelectorAll('input[name=why]').forEach(input => { input.checked = false; });
  $('why-text').value = '';
  $('why-dialog').showModal();
}

async function answer(reason) {
  $('why-send').disabled = true;
  await window.pilot.leaveReason({reason, text: $('why-text').value, mode}).catch(() => {});
  $('why-send').disabled = false;
  $('why-dialog').close();
  if (mode === 'stuck' && reason) toastMessage(t('pagesCommon.thanks'), t('pagesMisc.makerReads'), NO_PLACE.done, 'good');
}

export async function init() {
  window.pilot.onAskWhyLeaving(() => open('quit'));
  $('wizard-stuck').addEventListener('click', () => open('stuck'));
  $('why-send').addEventListener('click', () => answer(document.querySelector('input[name=why]:checked')?.value || (($('why-text').value.trim()) ? 'other' : '')));
  $('why-skip').addEventListener('click', () => answer(''));
  // Closing the dialog (Esc or ✕) while quitting still quits: the user asked to leave.
  $('why-dialog').addEventListener('cancel', () => { if (mode === 'quit') window.pilot.leaveReason({mode: 'quit'}); });
}
