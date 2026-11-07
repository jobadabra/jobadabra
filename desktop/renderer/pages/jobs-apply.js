// Jobs' "Apply to jobs" dialog (owner, 28 Oct 2026 rework of #2317): how many jobs, how Jobadabra applies (Settings → Apply's own cards), "Apply to N jobs".
// A card pick is this batch's mode only (never saved; the dialog opens on Settings → Apply's mode each time); a mode not built yet is a disabled "Coming soon" card. Pure parts: renderer/apply-dialog-model.js.
// Guard: test/unit/renderer/apply-dialog-mode.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {offerBrowser} from './browser-progress.js';
import {$, message} from './core.js';
import {applyChosen, applyOf} from '../apply-settings-model.js';
import {applyButtonLabel, applyDialogOutcome, applyDialogPick, applyDialogStart, createApplyStartGate} from '../apply-dialog-model.js';
import {askFullAutomation, modeCards} from './apply-settings.js';
import {toastMessage} from './startup.js';

const gate = createApplyStartGate();
let settings = {};   // the saved settings the dialog opened on
let picked = '', confirmedAt = '';   // the card the person clicked in THIS dialog (empty: none, the batch follows Settings) and, for Full automation, the confirmation given for it; both start over each time it opens
let saving = false;   // a pick is being confirmed

// The cards and the button from the saved settings; while a batch starts, the cards are off and the button stays "Starting…" (typing in the count changes nothing).
function draw() {
  $('apply-mode-cards').replaceChildren(modeCards(picked || applyOf(settings).mode, pick, {busy: saving || gate.isStarting()}));
  if (gate.isStarting()) return;
  $('apply-go').textContent = applyButtonLabel($('apply-n').value);
}

async function pick(mode) {
  if (saving || gate.isStarting()) return;
  saving = true;
  draw();
  try {
    const result = await applyDialogPick({mode, settings, confirm: askFullAutomation});
    if (result.ok) ({mode: picked, autoConfirmedAt: confirmedAt} = result);
  } finally {
    saving = false;
    draw();
  }
}

/** Wires the dialog once; startedApplying(): the Jobs list reads the jobs the batch marked. */
export function wireApplyDialog({startedApplying}) {
  $('apply-open').addEventListener('click', async () => {
    message('apply-message', '');
    settings = (await window.pilot.state().catch(() => null))?.settings || {};
    picked = ''; confirmedAt = '';   // Why (7 Nov 2026, owner, #3363: "The preselected modal apply modal option should be the one in settings"): every open starts on Settings' mode. No click, no pick sent: the first-choice gate replays Start after the person chose in it, and that choice must win (27 Oct 2026)
    draw();
    $('apply-dialog').showModal();
  });
  $('apply-n').addEventListener('input', draw);
  // Long job titles wrap in the status line; the action buttons keep their short labels.
  window.pilot.onApplyProgress(text => { if (gate.isStarting()) $('apply-start-status').textContent = text; });
  $('apply-go').addEventListener('click', async event => {
    event.preventDefault();
    if (!$('apply-n').reportValidity()) return;   // 1–10 whole jobs (the field's own min/max/step), said by the field itself
    const n = Number($('apply-n').value), go = $('apply-go');
    await gate.run(async () => {
      // Feedback at once: picking the jobs reads Notion and checks each posting is still open (a few seconds). Before a first choice the
      // first-Apply dialog opens over this one (lib/apply-choice-gate.js), and the batch goes on after it.
      Object.assign(go, {disabled: true, textContent: t('pagesCommon.starting')});
      go.classList.add('busy');
      $('apply-start-banner').hidden = false;
      $('apply-start-status').textContent = t('pagesJobs.choosing');
      $('apply-progress').hidden = false;   // the banner's progress bar stays below the action buttons
      draw();
      try {
        const result = await applyDialogStart({count: n, pick: picked, autoConfirmedAt: confirmedAt, chosen: applyChosen(settings), start: options => window.pilot.apply(options)});
        if (result.ok) startedApplying();   // the batch marked the jobs it started: read the list again
        if (result.ok && result.extensionNote) toastMessage('Chrome has an older extension', result.extensionNote, {view: 'settings'}, 'warn');
        if (result.needsExtension || result.cancelled) { $('apply-dialog').close(); return; }   // the install dialog opens (extension-needed.js), or Not now in the first-Apply dialog
        // Why (2026-10-28, owner screenshot): the green "queued" line kept the dialog open with nothing left to do; a toast says it and the dialog closes (a click on it opens Sessions).
        const outcome = applyDialogOutcome(result);
        if (outcome.close) { const {title, body, target, tone} = outcome.toast; toastMessage(title, body, target, tone); $('apply-dialog').close(); return; }
        message('apply-message', outcome.error, 'error');
        offerBrowser($('apply-browser'), result.code === 'BACKGROUND_BROWSER_MISSING');   // the download, right where it was asked for
      } catch (error) {   // the call itself failed (e.g. the app updated while open): say so, the button comes back below
        message('apply-message', `Could not start applying: ${error.message}`, 'error');
      } finally {
        go.disabled = false;
        go.classList.remove('busy');
        $('apply-progress').hidden = true;
        $('apply-start-banner').hidden = true;
      }
    });
    settings = (await window.pilot.state().catch(() => null))?.settings || settings;   // a first-Apply choice made meanwhile
    draw();
  });
}
