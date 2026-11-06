// Settings → connections: Apply with Claude, how often, Always on (the extension's card: extension-setup.js).
import {aiFamily} from '../ai-name.js';
import {alwaysOnNeeds, requirementRows} from '../always-on-needs.js';
import {notionConnected, openNotionConnect} from './notion-connect.js';
import {signInWait} from '../sign-in-wait.js';
import {shared} from './shared.js';
import {$, message, osText, show} from './core.js';
import {pill} from '../components.js';
import {hostedRuns, nextWord, scheduleWith, searchNextAt, whereRuns} from '../schedule-line.js';
import {saveDailyTarget} from './focus.js';
import {loadSettings} from './profile.js';
import {noteCheck, openSetting, refreshServices, renderOverview, showRunMode} from './settings.js';
import {toastMessage} from './startup.js';
import {goStep} from './wizard.js';
import {initGmailOffer, setGmailConnected} from './gmail-offer.js';
import {bindNotify} from './notify-settings.js';
import {showClaudePrereqs} from './claude-prereqs.js';
import {storeName} from '../store-words.js';
import {bindExtension, paintExtensionCardFirst, showExtensionStatus} from './extension-setup.js';
import {bindDesktopAiCard, showDesktopAiCard} from './desktop-ai-card.js';
import {draw as drawChoice, pick as pickWay} from './always-on-choice.js';
import {bindTest, setReady} from './always-on-test.js';

export {showExtensionStatus};

// A connection's way out: a red button beside Connect/Reconnect, not hidden in a ⋯ menu (owner, 9 Oct 2026).
const wayOut = (label, run) => { const button = document.createElement('button'); button.className = 'danger'; button.textContent = label; button.addEventListener('click', run); return button; };


// ---------- how often each job runs ----------
const SCHEDULE_DEFAULTS = {search: 4, mail: 3};   // what the two rows show before a choice is saved (lib/cadence.js DEFAULTS)
export function showSchedule() {
  const schedule = {...SCHEDULE_DEFAULTS, ...(shared.state.settings.schedule || {})};
  document.querySelectorAll('[data-schedule]').forEach(select => { select.value = String(schedule[select.dataset.schedule]); });
  showScheduleState();
}
// Each task's state beside its frequency: On (where it runs, when next), Off, On demand, or what it's missing.
export function showScheduleState(next = shared.nextRuns || {}) {
  const value = kind => document.querySelector(`[data-schedule="${kind}"]`)?.value;
  const hostedOn = hostedRuns(shared.hosted);
  const place = kind => whereRuns(kind, {hostedOn, cloudRepo: shared.state?.settings?.cloud?.repo || ''});
  const searchAt = searchNextAt({hostedOn, hostedAt: shared.hosted?.schedule?.next_run_at, appAt: next.search});
  let google = null;
  try { google = JSON.parse(localStorage.getItem('serviceChecks') || 'null')?.google?.connected ?? null; } catch {}
  const when = at => nextWord(at);
  const state = {
    search: value('search') === '0' ? ['Off'] : ['On', [place('search'), when(searchAt)].filter(Boolean).join(' · ')],
    mail: value('mail') === '0' ? ['Off'] : google === false ? ['Connect Google', '', '', 'warn'] : ['On', [place('mail'), when(next.mail)].filter(Boolean).join(' · ')],
  };
  document.querySelectorAll('[data-schedule-state]').forEach(node => {
    const [label, where, at, tone] = state[node.dataset.scheduleState] || ['Off'];
    node.className = `task-state${tone === 'warn' ? ' is-warn' : label === 'On' ? ' is-on' : ''}`;
    const detail = [where, at].filter(Boolean).join(' · ');
    node.replaceChildren(label, ...(detail ? [Object.assign(document.createElement('small'), {textContent: detail})] : []));
  });
}
// Automation: the schedules, the daily target and reminders are saved together with Save changes (enabled once
// something changed); with Always on, the GitHub repo is updated to the new schedule too.
// Automation saves each change at once (no Save button). A small toast says what was saved; with Always on, the GitHub
// repository is brought up to date once, a moment after the last change (several changes → one update).
const REPO_DELAY = 1500;
let repoTimer = null;
let lastToast = null;
function savedToast(title, body = '', section = 'automation') {   // section: the tab the pop-up opens (Notifications saves too, owner 3 Nov 2026)
  lastToast?.remove();
  const toast = lastToast = toastMessage(title, body, {view: 'settings', section}, 'good');
  setTimeout(() => toast.remove(), 3000);
}
// Both tabs that save at once (Automation, Notifications) show the line; updateRepo is shared, so the tab the person is on says "Updating…".
const saveState = text => { for (const id of ['automation-state', 'notifications-state']) $(id).textContent = text || 'Changes save automatically'; };
function updateRepo() {
  if (!shared.state.settings.cloud?.repo) return;
  clearTimeout(repoTimer);
  repoTimer = setTimeout(async () => {
    saveState(`Updating ${shared.state.settings.cloud.repo}…`);
    const result = await window.pilot.cloudConnect();
    saveState('');
    if (result.ok) savedToast('GitHub updated ✓', `${result.repo} follows the new settings.`);
    else toastMessage('GitHub not updated', `${result.error} Your change is saved on this Mac; change a setting again to retry.`, {card: 'cloud'}, 'bad');
  }, REPO_DELAY);
}
async function saveSchedule(select) {
  const schedule = scheduleWith(shared.state.settings.schedule, select.dataset.schedule, /^\d+$/.test(select.value) ? Number(select.value) : select.value);
  await window.pilot.saveSettings({schedule});
  shared.state = await window.pilot.state();
  const task = select.closest('.task-row')?.querySelector('b')?.textContent || 'Schedule';
  savedToast('Saved ✓', `${task}: ${select.selectedOptions[0]?.textContent}`);
  updateRepo();
}
async function saveReminders() {
  await window.pilot.saveSettings({focusReminders: $('set-remind').checked});
  $('focus-remind').checked = $('set-remind').checked;
  shared.state = await window.pilot.state();
  savedToast('Saved ✓', `Focus reminders ${$('set-remind').checked ? 'on' : 'off'}`);
}
// The target lives in Notion's ⚙️ Search settings: written only when it really changed (it's a slow round trip).
async function saveTarget() {
  const input = $('set-target');
  if (!input.value || input.value === input.dataset.saved) return;
  saveState(`Saving the daily target to ${storeName()}…`);
  const ok = await saveDailyTarget(input);
  saveState('');
  if (!ok) { input.value = input.dataset.saved || ''; return; }
  input.dataset.saved = input.value;
  savedToast('Saved ✓', `Daily application target: ${input.value}`);
  updateRepo();
}

// ---------- Always on: runs in the user's private GitHub repo, even with the Mac off ----------
export function showCloud() {
  const cloud = shared.state.settings.cloud;
  showRunMode();
  $('cloud-status').textContent = cloud?.repo
    ? osText(`${cloud.repo} · runs the schedule above, even with the Mac off`) : 'Runs your search every day in a private repository of yours, even when this Mac is off. Until then it runs on this Mac while the app is open.';
  $('cloud-connect').textContent = cloud?.repo ? 'Update' : 'Turn on';
  $('cloud-open').hidden = $('cloud-more').hidden = !cloud?.repo;
  $('cloud-more').replaceChildren(...(cloud?.repo ? [wayOut('Turn off Always on', () => $('cloud-off').click())] : []));
  showCloudPill();
  showCloudNeeds();
  $('auto-search').disabled = !!cloud?.repo;
  showTelegramCloud();
  drawChoice();
  showScheduleState();   // Why (5 Nov 2026, review): the place and time under Find jobs follow GitHub being turned on or off
}
// What Always on needs before GitHub can run anything: Notion, the person's own API key and GitHub, three sibling rows that each say what is missing and carry their own button
// (owner, 4 Nov 2026: "Notion should not be inside Github. They should be siblings. Both of them are needed"). A friend once pressed "Turn on", read a path in plain text and did not know what to do.
// The API key Always on needs for the chosen family.
const aiKey = () => (aiFamily() === 'openai' ? {name: 'OPENAI_API_KEY', provider: 'OpenAI', cli: 'Codex'} : {name: 'ANTHROPIC_API_KEY', provider: 'Anthropic', cli: 'Claude Code'});
const cloudMissing = () => alwaysOnNeeds(shared.state, aiKey());   // renderer/always-on-needs.js
function showCloudNeeds() {
  const on = !!shared.state.settings.cloud?.repo, {rows, done} = requirementRows(shared.state, aiKey(), {githubOn: on});
  $('aon-own-count').textContent = done === 3 ? 'All three are set up: Always on is fully active.' : `All three are needed for Always on to run: Notion, an API key and GitHub (${done} of 3 set up).`; // about Notion
  for (const row of rows) {
    const id = row.id === 'ai' ? 'key' : 'notion', go = $(`aon-${id}-go`);
    $(`aon-${id}-pill`).replaceChildren(pill(row.pill[0], row.pill[1], {dot: true}));
    $(`aon-${id}-line`).textContent = row.line;
    if (row.id === 'ai') $('aon-key-title').textContent = row.title;
    show(go, !!row.button);
    if (row.button) go.textContent = row.button;
    go.onclick = () => openSetting(row.id === 'ai' ? 'ai' : 'notion');
  }
  setReady([...rows.filter(row => row.pill[1] !== 'good').map(row => (row.id === 'ai' ? 'an API key' : row.title)), ...(on ? [] : ['GitHub'])]);   // the Test button needs all three
  $('aon-key-alt').dataset.need = rows[1].alt ? '1' : '';   // shown by always-on-choice.js draw(), which knows whether our servers can take it
  drawChoice();
  $('aon-key-alt').onclick = () => pickWay('ours');
}
function showCloudPill() {
  const on = !!shared.state.settings.cloud?.repo;
  $('cloud-pill').replaceChildren(cloudWaiting && !on ? pill('Setting up', 'info', {dot: true}) : on ? pill('On', 'good', {dot: true}) : pill('Off', 'neutral'));
}

// "Connected to …", or, when the setup found a repository from an earlier setup, which one and since when.
function connectedTo(result) {
  if (!result.existing) return `Connected to ${result.repo}`;
  const since = new Date(result.existing.createdAt).toLocaleDateString([], {day: 'numeric', month: 'short', year: 'numeric'});
  return `Using your existing private repository ${result.repo} (created ${since})`;
}

// Telegram buttons, always on (the user's own Cloudflare Worker; lib/telegram-cloud.js).
function showTelegramCloud() {
  const on = shared.state.settings.telegramCloud;
  show($('tg-cloud'), !!shared.state.settings.cloud?.repo);
  $('tg-cloud-status').textContent = on ? osText(`${on.url.replace('https://', '')} · your bot answers from Cloudflare, even with the Mac off`)
    : 'Your bot answers buttons and commands only while this app is open.';
  $('tg-cloud-pill').replaceChildren(on ? pill('On', 'good', {dot: true}) : pill('Off', 'neutral'));
  // Off: "Set up" opens the steps and the token field (Turn on sits beside the field). On: Update in the row, Turn off in ⋯.
  show($('tg-cloud-setup'), !on);
  if (on) show($('tg-cloud-form'), false);
  if (on) $('tg-cloud-actions').prepend($('tg-cloud-on')); else $('tg-cloud-form').querySelector('.inline').append($('tg-cloud-on'));
  $('tg-cloud-on').textContent = on ? 'Update' : 'Turn on';
  show($('tg-cloud-more'), !!on);
  $('tg-cloud-more').replaceChildren(...(on ? [wayOut('Turn off Telegram buttons', () => $('tg-cloud-off').click())] : []));
  refreshServices();  // Settings → Connections: the GitHub and Cloudflare cards move between Available and Connected
}
let cloudUrls = null;
let cloudWaiting = false;
let cloudSince = 0;

let googleOnly;   // the one part left unticked on Google's screen: Reconnect asks only for it (src/sources/google_scopes.py)
export async function showGoogle() {
  const google = await window.pilot.googleStatus().catch(() => ({connected: false}));
  const left = google.connected ? google.scopes?.missing || [] : [];
  googleOnly = left.length === 1 ? left[0] : undefined;
  $('google-status').textContent = google.connected ? `${left.length ? '⚠' : '✓'} Connected${google.email ? ` as ${google.email}` : ''}${left.length ? `. ${google.scopes.say}` : ''}` : google.error ? 'Sign-in expired: connect again' : 'Not connected';
  $('google-status').classList.toggle('on', !!google.connected);
  $('google-connect').textContent = google.connected ? 'Reconnect' : 'Connect Google';
  // A way out, like Always on's and Telegram buttons' (owner, 7 Oct 2026: "there is no way for me to disconnect from Gmail").
  $('google-more').hidden = !google.connected;
  $('google-more').replaceChildren(...(google.connected ? [wayOut('Disconnect Gmail', disconnectGoogle)] : []));
  setGmailConnected(google.connected);   // the Suggestions card and ⌘K follow (pages/gmail-offer.js)
  noteCheck({google: {connected: !!google.connected, email: google.email || ''}});  // the cards above follow
}
// Telegram's way out, the same ⋯ menu as Gmail's (owner, 7 Oct 2026).
export function showTelegram() {
  const on = !!(shared.state.secrets.TELEGRAM_BOT_TOKEN && shared.state.settings.telegramChatId);
  $('telegram-more').hidden = !on;
  $('telegram-more').replaceChildren(...(on ? [wayOut('Disconnect Telegram', disconnectTelegram)] : []));
}
async function disconnectTelegram() {
  message('telegram-message', 'Disconnecting…', 'waiting');
  const result = await window.pilot.telegramDisconnect().catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { message('telegram-message', result.error, 'error'); return; }
  await loadSettings();
  message('telegram-message', `Disconnected: no more messages${result.github === true ? ', from this Mac or Always on' : ''}. ` +
    `The bot${result.bot ? ` @${result.bot}` : ''} is still yours in Telegram (@BotFather → /deletebot removes it).`, 'ok');
}
async function disconnectGoogle() {
  message('google-message', 'Disconnecting…', 'waiting');
  const result = await window.pilot.googleDisconnect().catch(error => ({ok: false, error: error.message}));
  message('google-message', result.ok
    ? `Disconnected: Gmail and Calendar are no longer read${result.github === true ? ', here or by Always on' : ''}.${result.revoked ? '' : ' Google could not be reached: remove Jobadabra under myaccount.google.com → Security → Third-party access.'}`
    : result.error, result.ok ? 'ok' : 'error');
  showGoogle();
}
function alertLine(name, text) { const line = document.querySelector(`[data-secret="${name}"]`); line.textContent = text; line.classList.remove('on'); line.classList.add('is-plain'); }

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  initGmailOffer();   // the first Submit and a page asking for a mailed code open the Gmail dialog (lib/gmail-offer.js tells the window)
  paintExtensionCardFirst();   // the last known state at once; the live read below confirms or corrects it
  showDesktopAiCard().catch(() => {});   // Claude desktop app card (4/6)
  // No "Check again": the checklist refreshes by itself when you come back to the window (e.g. after installing
  // Claude Code or the Chrome extension), while the Settings checklist is open.
  window.addEventListener('focus', () => { if (document.getElementById('claude-prereqs-settings')?.hidden === false) showClaudePrereqs(); });   // back from installing: checked again
  showClaudePrereqs();
  setInterval(() => {
    if (document.querySelector('.view[data-view="settings"]').hidden) return;
    showExtensionStatus();
    if (!document.querySelector('[data-settings-page="overview"]').hidden) renderOverview().catch(() => {});
  }, 10000);
  // The run mode is a choice, not a signpost. "Always on" (when it is off) opens the card that sets it up;
  // "While app is open" (when Always on is on) turns it off, after saying what that changes — before this, either
  // click only scrolled to the Always on card, so the mode could not be switched from here at all (1 Oct 2026).
  document.querySelectorAll('[data-run-mode]').forEach(button => button.addEventListener('click', async () => {
    const on = !!shared.state.settings.cloud?.repo;
    const wantCloud = button.dataset.runMode === 'cloud';
    if (wantCloud === on) return;                      // already that mode: nothing to do
    if (wantCloud) { openSetting('cloud'); return; }   // setting it up is the Always on card's job
    const result = await window.pilot.cloudTurnOffConfirmed().catch(() => null);
    if (!result?.ok) return;
    shared.state = await window.pilot.state();
    showRunMode();
    showCloud();
    savedToast('Runs while the app is open', 'Always on is off. Your GitHub repository stays there.');
  }));
  $('run-mode-more').addEventListener('click', () => openSetting('cloud'));
  document.querySelectorAll('[data-schedule]').forEach(select => select.addEventListener('change', () => { saveSchedule(select); showScheduleState(); }));
  $('set-remind').addEventListener('change', saveReminders);
  bindNotify({savedToast, updateRepo});
  $('set-target').addEventListener('change', saveTarget);
  $('tg-cloud-setup').addEventListener('click', () => {
    const form = $('tg-cloud-form');
    show(form, form.hidden);
    if (!form.hidden) $('tg-cloud-token').focus();
  });
  $('tg-cloud-on').addEventListener('click', async () => {
    $('tg-cloud-on').disabled = true;
    message('tg-cloud-message', 'Setting up your bot helper on Cloudflare…');
    const result = await window.pilot.telegramCloudOn($('tg-cloud-token').value);
    $('tg-cloud-on').disabled = false;
    if (result.ok) { $('tg-cloud-token').value = ''; shared.state = await window.pilot.state(); showTelegramCloud(); }
    message('tg-cloud-message', result.ok ? 'Done ✓ Try a button in Telegram.' : result.error, result.ok ? 'ok' : 'error');
  });
  $('tg-cloud-off').addEventListener('click', async () => {
    await window.pilot.telegramCloudOff();
    shared.state = await window.pilot.state(); showTelegramCloud();
    message('tg-cloud-message', 'Off: the app answers your bot again while it\'s open.', 'ok');
  });
  $('cloud-connect').addEventListener('click', async () => {
    if (cloudMissing().length) { showCloudNeeds(); message('cloud-message', 'Finish Notion and the API key above first, then press Turn on.', 'bad'); return; } // about Notion
    $('cloud-connect').disabled = true;
    if (!cloudWaiting) message('cloud-message', 'Opening GitHub sign-in…');
    const result = await window.pilot.cloudConnect();
    $('cloud-connect').disabled = false;
    if (result.needsRepo) {
      // Signed in, not installed yet: open GitHub's install page (its repository picker) and wait for the install.
      cloudUrls = result;
      show($('cloud-steps'));
      if (!cloudWaiting) { window.pilot.openExternal(result.installUrl); cloudSince = Date.now(); }
      message('cloud-message', 'Signed in to GitHub ✓ Now pick the repository on GitHub. Waiting for the install…', 'waiting');
      cloudWaiting = true;
      showCloudPill();
      if (Date.now() - cloudSince < 10 * 60 * 1000) setTimeout(() => $('cloud-connect').click(), 5000);
      else { cloudWaiting = false; showCloudPill(); message('cloud-message', 'Still not installed. Install Jobadabra on a repository on GitHub, then press Turn on again.', 'error'); }
      return;
    }
    cloudWaiting = false;
    showCloudPill();
    if (result.needsChoice) {
      show($('cloud-steps'), false);
      $('cloud-repo').replaceChildren(...result.repos.map(name => Object.assign(document.createElement('option'), {value: name, textContent: name})));
      show($('cloud-choose'));
      message('cloud-message', 'Jobadabra is installed on several repositories: choose the one to use.', '');
      return;
    }
    if (!result.ok) { message('cloud-message', result.error, 'error'); return; }
    show($('cloud-steps'), false);
    shared.state = await window.pilot.state();
    showCloud();
    message('cloud-message', `${connectedTo(result)} ✓ ` +
      `${result.secrets.length} keys stored as encrypted secrets. The first run follows your schedule; press Search now to start one right away.`, 'ok');
  });
  window.pilot.onCloudStep(step => {
    if (step.code) {
      // The sign-in code, big and bold, with Copy: it's what the user has to find and type on github.com.
      const box = $('cloud-message');
      box.className = 'message';
      const code = Object.assign(document.createElement('b'), {className: 'device-code', textContent: step.code});
      const copy = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Copy'});
      copy.addEventListener('click', () => { navigator.clipboard.writeText(step.code); copy.textContent = 'Copied ✓'; });
      box.replaceChildren('In the browser tab that opened, enter this code and approve Jobadabra:', document.createElement('br'),
        code, ' ', copy, document.createElement('br'), Object.assign(document.createElement('span'), {className: 'muted small', textContent: step.url}));
    }
    else message('cloud-message', step.text);
  });
  $('cloud-use').addEventListener('click', async () => {
    $('cloud-use').disabled = true;
    const result = await window.pilot.cloudConnect($('cloud-repo').value);
    $('cloud-use').disabled = false;
    if (!result.ok) { message('cloud-message', result.error, 'error'); return; }
    show($('cloud-choose'), false);
    shared.state = await window.pilot.state();
    showCloud();
    message('cloud-message', `${connectedTo(result)} ✓ ${result.secrets.length} keys stored as encrypted secrets.`, 'ok');
  });
  $('cloud-create').addEventListener('click', () => window.pilot.openExternal(cloudUrls.createUrl));
  $('cloud-install').addEventListener('click', () => window.pilot.openExternal(cloudUrls.installUrl));
  $('cloud-open').addEventListener('click', () => window.pilot.openExternal(`https://github.com/${shared.state.settings.cloud.repo}`));
  $('cloud-off').addEventListener('click', async () => {
    await window.pilot.cloudOff();
    shared.state = await window.pilot.state();
    showCloud();
    message('cloud-message', 'Off. The app searches while it is open. Your GitHub repository is still there: delete it on GitHub, or turn this on again later.');
  });
  window.pilot.onTelegramWaiting(username => {
    message('telegram-message', `Now open t.me/${username} in Telegram and press Start (waiting up to 2 minutes)…`);
    window.pilot.openExternal(`https://t.me/${username}`);
  });
  $('auto-search').addEventListener('change', () => window.pilot.setAutomation({autoSearch: $('auto-search').checked}));
  $('open-login').addEventListener('change', () => window.pilot.setAutomation({openAtLogin: $('open-login').checked}));
  // While a sign-in waits (Google's page closed, "Back to safety"), the same button is Cancel sign-in: never stuck, never a second sign-in.
  const waitGoogle = signInWait($('google-connect'), () => window.pilot.googleConnectCancel());
  const waitNotion = signInWait($('set-notion-oauth'), () => window.pilot.notionOAuthCancel());
  // Google calls the app unverified: say so before the browser opens, with the three clicks that get through it.
  $('google-connect').addEventListener('click', () => $('google-warning-dialog').showModal());
  // The job-alert guide: each site's own page, in the browser (fixed addresses in index.html).
  $('alerts-guide').addEventListener('click', event => {
    const url = event.target.closest('[data-open-url]')?.dataset.openUrl;
    if (url && /^https:\/\//.test(url)) window.pilot.openExternal(url);
  });
  $('google-warning-go').addEventListener('click', async () => {
    $('google-warning-dialog').close();
    message('google-message', 'Finish the sign-in in your browser: on Google\'s warning page press Advanced, then Go to Jobadabra (unsafe). Closed that page? Press Cancel sign-in here.');
    const result = await waitGoogle(() => window.pilot.googleConnect({only: googleOnly}));
    message('google-message', result.ok ? 'Connected ✓' : result.error, result.ok ? 'ok' : result.cancelled ? '' : 'error');
    showGoogle();
  });
  $('set-notion-oauth').addEventListener('click', async () => {
    // Not connected yet (Notion later): the same prompt as everywhere, with the advantages.
    if (!notionConnected()) { openNotionConnect({reason: 'none', where: 'settings', from: 'settings', then: () => loadSettings()}); return; }
    message('set-notion-message', 'Waiting for Notion: approve in your browser, then come back here. Press Cancel sign-in to stop.');
    const result = await waitNotion(() => window.pilot.notionOAuth({from: 'settings-reconnect'}));
    message('set-notion-message', result.ok ? 'Reconnected ✓' : result.error || 'Not connected.', result.ok ? 'ok' : 'error');
    if (result.ok) { shared.state = await window.pilot.state(); loadSettings(); }
  });
  $('set-notion-save').addEventListener('click', async () => {
    const value = $('set-notion').value.trim();
    if (!value) return;
    const result = await window.pilot.notionConnect(value);
    if (!result.ok) { alertLine('NOTION_TOKEN', result.error || `Not found: ${(result.missing || []).join(', ') || 'columns missing'}`); return; }
    $('set-notion').value = '';
    loadSettings();
    // Connected with the data still on this Mac: the move, in the same prompt as every connect (pages/notion-connect.js "Move to Notion").
    if (result.stayedOnMac) { shared.state = await window.pilot.state(); openNotionConnect({reason: 'move', where: 'settings', from: 'settings', then: () => loadSettings()}); }
  });
  for (const [id, name, check] of [['anthropic', 'ANTHROPIC_API_KEY', 'checkAnthropic'], ['openai', 'OPENAI_API_KEY', 'checkOpenAI'], ['serpapi', 'SERPAPI_API_KEY', false], ['adzuna-id', 'ADZUNA_APP_ID', false],
    ['adzuna-key', 'ADZUNA_APP_KEY', false], ['jooble', 'JOOBLE_API_KEY', false], ['brave', 'BRAVE_SEARCH_API_KEY', false]]) {
    $(`set-${id}-save`).addEventListener('click', async () => {
      const value = $(`set-${id}`).value.trim();
      if (!value) return;
      const checked = check ? await window.pilot[check](value) : {ok: true};   // a free call: is the key valid?
      if (!checked.ok) { alertLine(name, checked.error || 'That key was rejected'); return; }
      try {
        await window.pilot.saveSecret(name, value);
      } catch (error) {
        alertLine(name, error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
        return;
      }
      $(`set-${id}`).value = '';
      loadSettings();
    });
  }
  bindExtension();
  bindTest();
  bindDesktopAiCard();
  $('open-data').addEventListener('click', () => window.pilot.showFolder('data'));
  $('rerun-wizard').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('welcome'); });
  $('ov-review-setup').addEventListener('click', () => $('rerun-wizard').click());  // the same, from Settings → Overview
}
