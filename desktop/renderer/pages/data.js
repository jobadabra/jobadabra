// Your data: where it lives, export, import, backup, reset.
import {settingsText} from '../../i18n/settings-native.js';
import {storeLabel} from '../settings-final-words.js';
import {date as displayDate} from '../../i18n/format.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {counted as countedLabel} from './page-counts.js';
import {$, message, show} from './core.js';
import {openInNotion, openNotionConnect} from './notion-connect.js';
import {shared} from './shared.js';
import {MOVE_WORDS, movedText} from '../store-move-text.js';
import {toastMessage} from './startup.js';
import {startProgress} from './data-progress.js';
import {whileBusy} from '../busy-dialog.js';

// ---------- automatic backup of this computer's data (lib/backup.js) ----------
async function showBackup() {
  const status = await window.pilot.backupStatus();
  const where = `${status.place} → Jobadabra Backups`;
  $('backup-last').textContent = status.at ? displayDate(new Date(status.at), {dateStyle: 'medium', timeStyle: 'short'}) : t('pagesCommon.noneYet');
  $('backup-where').textContent = where.replace(' → ', ' / ');
}

// "Exported ✓ <file name>" with Show in Finder: the folder path has the person's name in it, so only the name is written.
function savedLine(id, words, file) {
  const line = $(id);
  line.className = 'message ok';
  const link = document.createElement('button');
  link.className = 'arrow-link'; link.textContent = t('pagesFieldsStatus.showFinder');   // Why (#3444): t() adapts the trusted platform template ("Show in File Explorer") before interpolation.
  link.addEventListener('click', () => window.pilot.showFile(file));
  line.replaceChildren(`${words} ${file.split(/[\\/]/).pop()} `, link);
}

// ---------- your data: where it lives (lib/store-handlers.js) ----------
// The card's one line of news (an error, "kept on this Mac ✓"): shown only when there is one, so an empty line leaves no gap.
const say = (text, tone) => { message('store-message', text, tone); show($('store-message'), !!text); };
async function showStore() {
  const store = await window.pilot.storeState();
  const cloud = store.caps.includes('cloud'), links = store.caps.includes('links');
  const unconnected = !store.trying && store.tracking === false;   // Notion chosen, not connected (#410): it asks to connect, as while trying
  const pill = $('store-pill');
  pill.textContent = store.trying ? t('pagesProfile.notChosen') : unconnected ? t('pagesCommon.notConnected') : storeLabel(store, shared.state.settings.store);
  pill.className = `ui-pill ${store.trying || unconnected ? 'tone-warn' : 'tone-good'}`;
  $('store-lead').textContent = store.trying
    ? t('pagesDynamicCvData.m119', {"value1": store.choice ? t('pagesDynamicCvData.macOrNotion') : t('pagesDynamicCvData.yourNotion')})   // about Notion
    : unconnected ? t('pagesLettersData.notionStoreConnect')   // about Notion
    : cloud ? t('pagesLettersData.notionStore')
      : t('pagesLettersData.localStore');   // about Notion
  $('store-where').textContent = store.trying ? t('pagesProfile.notChosenYet') : storeLabel(store, shared.state.settings.store);
  $('store-cloud').textContent = cloud && !store.trying && !unconnected ? t('pagesProfile.available') : t('pagesProfile.needsNotion');
  show($('store-keep'), store.trying && store.choice);
  show($('store-connect'), store.trying || unconnected);
  show($('store-move'), !store.trying && !cloud);
  show($('store-open'), links && !!shared.state?.notion?.NOTION_PROFILE_PAGE_ID);
  // The other cards mention Notion only when it holds the data.
  show($('backup-notion-line'), links);
  show($('data-notion-line'), links);
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  startProgress();
  showStore();
  $('store-keep').addEventListener('click', async () => {
    $('store-keep').disabled = true;
    const result = await window.pilot.keepOnThisMac();
    $('store-keep').disabled = false;
    if (!result?.ok) { say(result?.error || t('pagesAuditFirst.a52'), 'error'); return; }
    say(t('pagesFieldsStatus.localData'), 'ok');
    shared.state = await window.pilot.state();
    showStore();
  });
  $('store-connect').addEventListener('click', () => openNotionConnect({reason: 'none', where: 'settings', from: 'settings', then: () => showStore()}));
  // The move (lib/store-move.js): its progress as it copies, then what moved and which texts Notion already had (kept there, this Mac's in the archive).
  window.pilot.onStoreMoveProgress(({entity, done, total} = {}) =>
    say(t('pagesShortActivity.m105', {"value1": MOVE_WORDS[entity] || entity, "done": done, "total": total}), 'waiting'));
  // "Move my data to Notion": the same prompt as every connect (pages/notion-connect.js, "Connect and move" or "Move to Notion"); its result lands here.
  $('store-move').addEventListener('click', () => openNotionConnect({reason: 'move', where: 'settings', from: 'settings', then: async result => {
    if (!result?.ok) { say(result?.text || result?.error || t('pagesStrategy.notMoved'), 'error'); return; }
    shared.state = await window.pilot.state();
    await showStore();
    say(movedText(result), 'ok');
  }}));
  $('store-open').addEventListener('click', event => openInNotion('NOTION_PROFILE_PAGE_ID', event));

  // ---------- your data: export / import ----------
  $('export-data').addEventListener('click', async () => {
    // Notion data is not exported: it stays in Notion, with Notion's own history, Duplicate, Export and Move (owner, 8 Oct 2026)
    const result = await window.pilot.exportProfile({keys: $('export-keys').checked, accounts: $('export-accounts').checked});
    if (result.ok) savedLine('data-message', t('pagesFieldsStatus.exported'), result.file);
    else if (result.cancelled) message('data-message', t('pagesProfile.exportCancelled'), 'waiting');
    else if (result.error) message('data-message', t('pagesDynamicCvData.m120', {"error": result.error}), 'error');
  });
  // Settings → Your data, and the setup's Welcome (after a reset the app opens at the setup, where Settings is out of reach: 6 Oct 2026).
  document.querySelectorAll('[data-import]').forEach(button => button.addEventListener('click', async () => {
    const result = await window.pilot.importProfile();
    if (result?.cancelled) { if (button.id === 'import-data') message('data-message', t('pagesProfile.importCancelled'), 'waiting'); return; }
    if (!result?.error) return;
    if (button.id === 'import-data') message('data-message', t('pagesDynamicCvData.m121', {"error": result.error}), 'error');
    else toastMessage(t('pagesProfile.importFailed'), result.error, {card: 'data'}, 'bad');
  }));
  // ---------- clear my job list (src/clear_jobs.py): the counts first, then a backup and the clear ----------
  const clearBox = $('clear-jobs-confirm');
    const showClearCounts = async () => {
    const plan = await window.pilot.clearJobsPlan();
    if (plan?.error || plan?.ok === false) { message('data-message', plan.error || t('pagesLettersData.countFailed'), 'error'); return false; }
    const n = (count, word) => countedLabel(word, count);
    $('clear-jobs-counts').textContent = t('pagesDynamicCvData.m122', {"n": n(plan.clear, 'job'), "n2": n(plan.keep, 'job')});
    $('clear-jobs-go').disabled = plan.clear === 0;
    return true;
  };
  $('clear-jobs').addEventListener('click', async () => {
    $('clear-jobs').disabled = true;
    const ok = await showClearCounts();
    $('clear-jobs').disabled = false;
    if (ok) { show($('clear-jobs'), false); show(clearBox, true); }
  });
  $('clear-jobs-cancel').addEventListener('click', () => { show(clearBox, false); show($('clear-jobs'), true); });
  $('clear-jobs-go').addEventListener('click', async () => {
    $('clear-jobs-go').disabled = true;
    // Why (29 Oct 2026, owner): a blocking wait is one centered dialog over whatever screen is open, never a strip in this page; its end is a toast.
    // A rejected clear (an IPC error, a thrown write) still ends the wait: the toast says it, and the Clear button comes back (Gitar on #2466).
    let result;
    try {
      result = await whileBusy($('busy-dialog'), {title: t('pagesLettersData.backupClear'), note: t('pagesAuditFirst.a53')}, () => window.pilot.clearJobs());
    } catch (error) { result = {ok: false, error: error?.message || String(error)}; }
    finally { $('clear-jobs-go').disabled = false; show(clearBox, false); show($('clear-jobs'), true); }
    if (!result?.ok) { toastMessage(t('pagesProfile.listNotCleared'), result?.error || t('pagesProfile.nothingChanged'), {card: 'data'}, 'bad'); return; }
    shared.allJobs = [];
    toastMessage(t('pagesProfile.listCleared'), t('pagesDynamicCvData.m123', {"cleared": result.cleared, "kept": result.kept}), {view: 'jobs'}, 'good');
  });
  showBackup();
  $('backup-now').addEventListener('click', async () => {
    const result = await window.pilot.backupNow();
    if (result.ok) savedLine('data-message', t('pagesFieldsStatus.backedUp'), result.file);
    else message('data-message', result.error === 'cancelled' ? t('pagesProfile.backupCancelled') : t('pagesDynamicCvData.m124', {"error": result.error}), result.error === 'cancelled' ? 'waiting' : 'error');
    showBackup();
  });
  $('backup-show').addEventListener('click', () => window.pilot.showBackups());

  // ---------- danger zone: reset this computer's Jobadabra data ----------
  // Reset is allowed after the export (the same one as Settings → Your data, the same save dialog) or after choosing to go without it.
  const WORD = 'RESET';
  // One place says whether the button can be pressed and why not: the hint under the field, the button's title and aria-label.
  const syncReset = () => {
    const typed = $('reset-confirm').value.trim(), unlocked = !$('reset-confirm').disabled;
    const left = WORD.length - typed.length;
    const ready = unlocked && typed === WORD;
    const hint = !unlocked ? t('pagesAuditFirst.a54') : ready ? settingsText('resetReady') : !typed ? t('pagesDynamicCvData.m125', {"WORD": WORD})
      : WORD.startsWith(typed) ? t('pagesDynamicCvData.m126', {"left": left, count: left}) : t('pagesDynamicCvData.m127', {"WORD": WORD});
    $('reset-go').disabled = !ready;
    $('reset-go').title = ready ? '' : hint;
    $('reset-go').setAttribute('aria-label', ready ? t('pagesProfile.resetRestart') : t('pagesDynamicCvData.m128', {"hint": hint}));
    $('reset-hint').textContent = hint;
    $('reset-hint').classList.toggle('ready', ready);
  };
  const allowReset = (state, tone) => {
    const chip = $('reset-export-state');
    chip.textContent = state; chip.className = `ui-pill ${tone}`.trim(); chip.hidden = false;
    $('reset-confirm').disabled = false; syncReset(); $('reset-confirm').focus();
  };
  $('reset-export').addEventListener('click', async () => {
    const result = await window.pilot.exportProfile({keys: false, accounts: $('reset-export-accounts').checked});
    if (result?.ok) allowReset(t('pagesShortActivity.m107', {"value1": result.file.split(/[\\/]/).pop()}), 'tone-good');
    else if (result?.error) message('reset-message', t('pagesDynamicCvData.m129', {"error": result.error}), 'error');
  });
  $('reset-skip-export').addEventListener('click', () => allowReset(settingsText('resetSkipped'), ''));
  $('reset-confirm').addEventListener('input', syncReset);
  syncReset();
  $('reset-go').addEventListener('click', async () => {
    if ($('reset-confirm').value.trim() !== WORD) return;
    const result = await window.pilot.resetProfile();
    if (result?.error) message('reset-message', result.error, 'error');
    else if (!result?.ok) message('reset-message', t('pagesProfile.notReset'), 'waiting');
  });
  window.pilot.lastReset().then(done => {
    if (done?.failed) toastMessage(t('pagesProfile.importResetFailed'), t('pagesDynamicCvData.m130', {"failed": done.failed}), {card: 'data'}, 'bad');
    else if (done?.imported) toastMessage(t('pagesProfile.imported'), t('pagesDynamicCvData.m131', {"backup": done.backup}), {card: 'data'}, 'good');
    // The backup's Profile and tracking are in its Notion workspace (lib/reset.js notionLeftBehind): say which one to connect, before a new one is made.
    if (done?.imported && done.notionElsewhere) toastMessage({title: t('pagesProfile.connectSame'),
      body: t('pagesAuditFirst.a55')
        + t('pagesAuditFirst.a56'), target: {view: 'settings', section: 'connections'}, tone: 'warn'});
    else if (done?.deleted) toastMessage(t('pagesProfile.reset'), t('pagesLettersData.previousDeleted'), {card: 'data'}, 'info');
  });
}
