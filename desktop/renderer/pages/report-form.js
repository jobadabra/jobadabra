// "Report this form" in the app window: the switch in Settings and the line about what this install has sent (and may delete). The report itself is made and sent from the extension's panel (owner, 19 Oct 2026):
// its popup shows what goes and sends; lib/report-handlers.js holds the record meanwhile. Guard: test/unit/extension/report-panel.test.js.
import '../../i18n/screens-pages.js';
import {counted} from './page-counts.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';

const plural = (n, word) => counted(word, n);

// The line in Settings about what this install has sent (and may delete).
async function sent() {
  const {count} = await window.pilot.reportFormSent().catch(() => ({count: 0}));
  $('report-sent-row').hidden = !count;
  $('report-sent-count').textContent = t('pagesDynamicProfileReady.m318', {"plural": plural(count, 'report'), count: count});
}

export async function init() {
  const state = await window.pilot.reportFormGet().catch(() => ({on: true, ready: false}));
  const show = (on, ready) => { $('setting-report-form').hidden = !ready; };
  show(state.on, state.ready);
  $('report-form-on').checked = state.on;
  $('welcome-trace').checked = state.on;   // the wizard's one checkbox (on by default) is the same switch
  $('welcome-trace').addEventListener('change', async event => { const {on} = await window.pilot.reportFormSet(event.target.checked); $('report-form-on').checked = on; });
  $('report-form-on').addEventListener('change', async event => { const {on} = await window.pilot.reportFormSet(event.target.checked); $('welcome-trace').checked = on; show(on, true); });
  $('report-delete').addEventListener('click', async () => { $('report-delete').disabled = true; await window.pilot.reportFormDeleteAll().catch(() => null); $('report-delete').disabled = false; sent(); });
  sent();
}

