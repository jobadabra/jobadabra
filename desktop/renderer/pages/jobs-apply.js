// Jobs' "Apply to jobs" dialog (owner, 28 Oct 2026 rework of #2317): how many jobs, how Jobadabra applies (Settings → Apply's own cards), "Apply to N jobs".
// A card pick is this batch's mode only (never saved; the dialog opens on Settings → Apply's mode each time); a mode not built yet is a disabled "Coming soon" card. Pure parts: renderer/apply-dialog-model.js.
// Guard: test/unit/renderer/apply-dialog-mode.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {offerBrowser} from './browser-progress.js';
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {$, message} from './core.js';
import {applyChosen, applyOf} from '../apply-settings-model.js';
import {applyButtonLabel, applyDialogOutcome, applyDialogPick, applyDialogStart, createApplyStartGate, mergeHeld} from '../apply-dialog-model.js';
import {askFullAutomation, modeCards} from './apply-settings.js';
import {runCheck, wireApplyCheck} from './apply-check.js';
import {toastMessage} from './startup.js';

const gate = createApplyStartGate();
let settings = {};   // the saved settings the dialog opened on
let picked = '', confirmedAt = '';   // the card the person clicked in THIS dialog (empty: none, the batch follows Settings) and, for Full automation, the confirmation given for it; both start over each time it opens
let saving = false;   // a pick is being confirmed
let batchFinished = false;
// Why (7 Nov 2026, #3424): each attempted job needs a clear status and an inspection path in the batch dialog.
// Why (8 Nov 2026, owner: "bad UI"; the two reds were one colour for two different things): a status is icon + word; a verdict about the job (not eligible, not started) is a warning, only a failure is red.
const OUTCOMES = {
  started: ['Started', 'good', 'tick'], prepared: ['Ready', 'info', 'tick'], ineligible: ['Not eligible', 'warn', 'flag'],
  failed: ['Could not prepare', 'bad', 'close'], 'not-started': ['Not started', 'warn', 'clock'], busy: ['Already open', 'neutral', 'info'], 'already-queued': ['Already queued', 'warn', 'clock'], skipped: ['Skipped', 'warn', 'info'],
};

// The cards and the button from the saved settings; while a batch starts, the cards are off and the button stays "Starting…" (typing in the count changes nothing).
function draw() {
  $('apply-mode-cards').replaceChildren(modeCards(picked || applyOf(settings).mode, pick, {busy: saving || gate.isStarting()}));
  if (gate.isStarting()) return;
  const go = $('apply-go');
  go.textContent = applyButtonLabel($('apply-n').value);
  go.hidden = batchFinished;
}

function showOutcomes(outcomes = [], openJob) {
  const list = $('apply-outcomes');
  list.replaceChildren();
  list.hidden = !outcomes.length;
  $('apply-dialog').classList.toggle('apply-result', outcomes.length > 0);   // Why (8 Nov 2026, owner: "bad UI"): one state at a time: while the results show, the form (count, modes, Apply) is hidden
  for (const outcome of outcomes) {
    const row = el('div', 'apply-outcome');
    row.setAttribute('role', 'listitem');
    const heading = el('div', 'apply-outcome-head');
    const name = outcome.title || outcome.company || 'Job';
    const open = Object.assign(el('button', 'link apply-outcome-title', name), {type: 'button', title: 'Open this job'});   // the title opens the job, as in the Jobs list (no separate "Inspect" button)
    open.addEventListener('click', () => {
      $('apply-dialog').close();
      openJob({url: outcome.url, title: outcome.title || '', company: outcome.company || ''}, 'application');
    });
    heading.append(open);
    const [label, tone, glyph] = OUTCOMES[outcome.status] || OUTCOMES.skipped;
    const status = pill(label, tone);
    status.prepend(icon(glyph));
    heading.append(status);
    row.append(heading);
    if (outcome.reason) row.append(el('p', 'muted small apply-outcome-reason', outcome.reason));
    list.append(row);
  }
  const again = $('apply-again');
  if (again) again.hidden = !outcomes.length || batchFinished;
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

/** Wires the dialog once; startedApplying(): the Jobs list reads marked jobs; openJob: the Jobs page's drawer opener, injected to keep this dialog out of page dependency cycles. */
export function wireApplyDialog({startedApplying, openJob}) {
  $('apply-open').addEventListener('click', async () => {
    message('apply-message', '');
    settings = (await window.pilot.state().catch(() => null))?.settings || {};
    picked = ''; confirmedAt = '';   // Why (7 Nov 2026, owner, #3363: "The preselected modal apply modal option should be the one in settings"): every open starts on Settings' mode. No click, no pick sent: the first-choice gate replays Start after the person chose in it, and that choice must win (27 Oct 2026)
    batchFinished = false;
    showOutcomes([], openJob);
    draw();
    $('apply-dialog').showModal();
  });
  $('apply-n').addEventListener('input', draw);
  const again = Object.assign(el('button', 'primary', 'Change and try again'), {type: 'button', id: 'apply-again', hidden: true});   // the result state's way back to the form
  again.addEventListener('click', () => { message('apply-message', ''); batchFinished = false; showOutcomes([], openJob); draw(); });
  $('apply-go').before(again);
  wireApplyCheck();
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
      showOutcomes([], openJob);
      $('apply-start-banner').hidden = false;
      $('apply-start-status').textContent = t('pagesJobs.choosing');
      $('apply-progress').hidden = false;   // the banner's progress bar stays below the action buttons
      draw();
      try {
        // Why (7 Nov 2026, owner, fa: "the practice should go first ... and letting him confirm one more time"): a Full automation batch is held by the app; its check and the person's answer to the split (apply-check.js) are its result.
        const result = await applyDialogStart({count: n, pick: picked, autoConfirmedAt: confirmedAt, chosen: applyChosen(settings), start: options => window.pilot.apply(options).then(answer => (answer?.check ? runCheck(answer.check).then(answered => mergeHeld(answer, answered)) : answer))});
        if (result.ok || result.outcomes?.length) await Promise.resolve(startedApplying()).catch(() => {});   // a prepared row may leave New even when it never queued: refresh before leaving an Inspect action in the dialog
        if (result.ok && result.extensionNote) toastMessage('Chrome has an older extension', result.extensionNote, {view: 'settings'}, 'warn');
        if (result.needsExtension || result.cancelled) { $('apply-dialog').close(); return; }   // the install dialog opens (extension-needed.js), or Not now in the first-Apply dialog
        // Why (2026-10-28, owner screenshot): the green "queued" line kept the dialog open with nothing left to do; a toast says it and the dialog closes (a click on it opens Sessions).
        const outcome = applyDialogOutcome(result);
        if (!outcome.close) offerBrowser($('apply-browser'), outcome.browserOffer);
        if (outcome.outcomes?.length) {
          // Why (7 Nov 2026, #3424, review): showing job rows must not make a fully refused batch's error look neutral.
          message('apply-message', outcome.error, result.ok ? undefined : 'error');
          batchFinished = !!result.ok;   // before showOutcomes: it hides "Change and try again" for a batch that started something
          showOutcomes(outcome.outcomes, openJob);   // Why (7 Nov 2026, #3424): keep partial success inspectable and block a duplicate batch from the finished dialog.
          return;
        }
        if (outcome.close) { const {title, body, target, tone} = outcome.toast; toastMessage(title, body, target, tone); $('apply-dialog').close(); return; }
        message('apply-message', outcome.error, 'error');
      } catch (error) {   // the call itself failed (e.g. the app updated while open): say so, the button comes back below
        message('apply-message', t('pagesDynamicJobs.m215', {"message": error.message}), 'error');
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
