// Settings → Application profile.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {mountContactControls} from '../contact-controls.js';
import {showMode} from '../assistant-mode.js';
import {showClaudeAuto} from '../claude-auto.js';
import {contactHints} from '../audience.js';
import {openInNotion, showNotionPanel} from './notion-connect.js';
import {showStoreParts} from './store-parts.js';
import {addQuestion, loadApplicationAnswers} from './application-answers.js';
import {pick} from '../tab-choice.js';
import {remembered} from '../view-memory.js';
import {initExperience, loadExperience} from './experience.js';
import {loadExperienceProfile} from './experience-profile.js';
import {startOfficeProgress} from './office-progress.js';
import {loadLetterStyle} from './letter-style.js';
import {initLetter, loadLetter} from './base-letter.js';
import {loadPortrait} from './portrait.js';
import {wireTabLinks} from './profile-save-bar.js';
import {moreButton, openMenu} from '../components.js';
import {cvCheckAction, lastCheck, showCvCheck} from '../cv-check-view.js';
import {documentFacts} from '../cv-check-model.js';
import {icon} from '../icons.js';
import {costText, dollars} from '../ai-cost.js';
import {shared} from './shared.js';
import {keyRow} from '../service-status.js';
import {byStore, storeName} from '../store-words.js';
import {showCloud, showExtensionStatus, showGoogle, showSchedule, showTelegram} from './connections.js';
import {$, message, osText, runWhen, show} from './core.js';
import {showCvChanged} from './cv-change.js';
import {onCvReplaced} from './cv-replace.js';
import {openSetting, renderOverview} from './settings.js';
import {goStep} from './wizard.js';
import {showEngineSettings} from './ai-engine.js';
import {humanError, isSpendingLimit} from '../run-warnings.js';
import {cvStateText} from '../cv-state.js';
import {loadProposals} from './contact-proposals.js';
import {contactChangedIn, contactDirty, contactRead, factsChangedIn, registerDetails} from './details-drafts.js';
import {guardLeave} from './nav.js';
import {profileBar} from './profile-save-bar.js';
import {mountProfileMenu} from './profile-menu.js';
import {showFacts} from './details-facts.js';
import {initDetailsRead, linksView} from './details-read.js';
import {reading} from '../contact-reading.js';
import {swr} from '../swr.js';
import {foldProfilePanels, initFoldBar, showFoldBar} from '../profile-fold.js';
import {showNotify} from './notify-settings.js';

// ---------- Settings → Application profile: tabs (CV, Your details, Experience, What we learned, Cover letter) ----------
// Your details is drawn once with the settings (showContact): switching to it never redraws the form, so unsaved edits stay.
// Strategy → Job preferences, through the sidebar's own Strategy button (nav.js imports this file).
const openJobPreferences = () => { document.querySelector('.nav[data-view=strategy]')?.click(); setTimeout(() => $('strategy-job-prefs')?.scrollIntoView({block: 'start'}), 300); };
export function profileTab(name, {byDefault = false} = {}) {
  if (!byDefault) pick();   // a person's pick (or a deep link) wins over a default that arrives late (tab-choice.js)
  if (name === 'knowledge') name = 'answers';   // Form knowledge is a section of Application answers since 16 Oct 2026 (owner)
  // The Preferences tab is gone (owner, 17 Oct 2026: "General Preferences links can open Strategy"): its old name opens Strategy → Job preferences.
  if (name === 'profiletext') { openJobPreferences(); return; }
  if (![...document.querySelectorAll('[data-profile-tab]')].some(tab => tab.dataset.profileTab === name)) name = 'cv';
  remembered('profileTab', name);
  document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.profileTab === name));
  document.querySelectorAll('[data-profile-panel]').forEach(panel => {
    show(panel, panel.dataset.profilePanel === name && panel.dataset.wanted !== '0');   // a conditional part keeps its wish (pages/tab-part.js)
  });
  showStoreParts();
  showFoldBar();
  if (name === 'answers') loadApplicationAnswers();
  else if (name === 'experience') loadExperience();
  else if (name === 'letter') { loadLetterStyle(); loadLetter(); }
  else if (name === 'portrait') loadPortrait();
  else if (name === 'cv') { loadCvSetting(); showCvChanged(); }
}
// What we learned's ⋯ (one "View source" link per page, in a menu: owner, 18 Oct 2026, fix 10); the button shows only where the store has pages.
function answersMenu() {
  openMenu($('answers-review'), [{label: t('pagesDynamicProfileReady.m298', {"storeName": storeName()}), icon: 'external', run: () => openInNotion('NOTION_ANSWERS_PAGE_ID')}]);
}
// Professional links: shown as tiles; Edit shows the fields (saved by the Profile page's one save bar).
// The links card's read view (pages/details-read.js linksView; GitHub only while its box shows).
const showLinks = () => $('links-view')?.replaceChildren(linksView());
// Sidebar: the Notion pages, most used first. Click opens them in the app's Notion window; ⌘-click in the browser.
const NOTION_LINKS = [['NOTION_MATCHES_DB', t('pagesExtraLabels.jobMatches'), 'target'], ['NOTION_APPLICATIONS_DB', t('pagesCommon.applications'), 'layers'],
  ['NOTION_EVENTS_DB', t('pagesExtraLabels.repliesEvents'), 'mail'], ['NOTION_INTERVIEWS_DB', t('pagesFocusReports.interviews'), 'mic'], ['NOTION_INSIGHTS_DB', t('pagesExtraLabels.insights'), 'chart'],
  ['NOTION_PIPELINE_PAGE', t('pagesExtraLabels.pipeline'), 'columns'], ['NOTION_PROFILE_PAGE_ID', t('pagesCommon.profile'), 'user'], ['NOTION_ANSWERS_PAGE_ID', t('pagesExtraLabels.standardAnswers'), 'file'],
  ['NOTION_SEARCH_SETTINGS_PAGE', t('pagesExtraLabels.searchSettings'), 'settings'], ['NOTION_KNOWLEDGE_PAGE', t('pagesExtraLabels.formKnowledge'), 'bookmark'],
  ['NOTION_EMPLOYERS_DB', t('pagesExtraLabels.employers'), 'building'], ['NOTION_CRON_RUNS_DB', t('pagesExtraLabels.searchRuns'), 'search'], ['NOTION_AGENT_RUNS_DB', t('pagesExtraLabels.formFills'), 'bot']];
function renderNotionLinks() {
  const box = $('notion-links');
  box.querySelectorAll('.notion-link').forEach(link => link.remove());
  const links = NOTION_LINKS.filter(([env]) => shared.state.notion?.[env]);
  show(box, links.length > 0);
  for (const [env, label, glyph] of links) {
    const link = Object.assign(document.createElement('button'), {className: 'notion-link', textContent: label,
      title: osText(t('pagesDynamicProfileReady.m299', {"value1": shared.state.notionTitles?.[env] || label}))});
    link.prepend(icon(glyph));
    link.addEventListener('click', event => window.pilot.openNotion(shared.state.notion[env], event.metaKey || event.ctrlKey));
    box.append(link);
  }
}

// ---------- Profile → CV: the document row and the CV check (renderer/cv-check-view.js) ----------
const checkOptions = () => ({cvName: shared.state?.settings?.cvName || '', when: runWhen, say: (text, tone) => message('cvc-message', text, tone)});
export async function loadCvCheck() { showCvCheck(await window.pilot.cvCheckStatus().catch(() => null), checkOptions()); }
let cvReadBlocked = false;
let readCvPdf = () => {};   // set by initProfile (it needs the page's error words)   // out of AI credit: another read would fail the same way until credit is added
onCvReplaced(() => loadCvSetting());   // a replaced or built CV: size, date, state and the CV check follow it at once (pages/cv-replace.js)
export async function loadCvSetting() {
  await loadCvCheck();
  const status = await window.pilot.cvStatus();
  // One glance: ready (and which design), or not read yet. ✂️ Tailor CV on a job uses it.
  $('cv-state').textContent = cvStateText(status, shared.cvReadFailed);
  $('cv-facts').textContent = [t('pagesExtraLabels.currentCv'), documentFacts({pages: lastCheck()?.ats?.pages, ...(status.file || {})}, runWhen)].filter(Boolean).join(' · ');
  $('cv-view').hidden = !status.base;
  // ⋯ the rarer CV actions: read the PDF again (or for the first time), and the folder with the CV's files.
  $('cv-more').replaceChildren(moreButton(() => [
    {label: status.base ? t('pagesSetup.readCvAgain') : t('pagesSetup.readCv'), icon: 'refresh', disabled: cvReadBlocked, run: readCvPdf},
    {label: t('pagesSetup.cvFolder'), icon: 'folder', run: () => window.pilot.showCvFolder()}], t('pagesSetup.cvActions')));
}

export async function loadSettings() {
  shared.state = await window.pilot.state();
  showNotionPanel();
  const hints = await window.pilot.secretHints();
  for (const [id, name, empty] of [['set-anthropic', 'ANTHROPIC_API_KEY', 'sk-ant-…'], ['set-openai', 'OPENAI_API_KEY', 'sk-…'], ['set-notion', 'NOTION_TOKEN', 'ntn_…'],
    ['set-telegram', 'TELEGRAM_BOT_TOKEN', '123456789:AA…'], ['set-serpapi', 'SERPAPI_API_KEY', t('pagesExtraLabels.serpapiKey')], ['set-brave', 'BRAVE_SEARCH_API_KEY', t('pagesExtraLabels.braveKey')], ['set-adzuna-id', 'ADZUNA_APP_ID', t('pagesExtraLabels.adzunaId')],
    ['set-adzuna-key', 'ADZUNA_APP_KEY', t('pagesExtraLabels.adzunaKey')], ['set-jooble', 'JOOBLE_API_KEY', t('pagesExtraLabels.joobleKey')]]) {
    if ($(id)) $(id).placeholder = hints[name] ? t('pagesDynamicProfileReady.m300', {"name": hints[name]}) : empty;
  }
  renderNotionLinks();
  showEngineSettings();
  showCloud();
  showSchedule();
  showNotify();
  showContact();
  showClaudeAuto();
  showMode(shared.state.settings);
  document.querySelectorAll('[data-secret]').forEach(line => {
    const set = (shared.state.ownSecrets || shared.state.secrets)[line.dataset.secret];   // the person's own keys: Free AI's token in the same slot is not "Connected" (lib/secrets.js)
    const row = keyRow(line.dataset.secret, set, shared.state.aiKeyBad);   // only the refused key's own row says so (lib/ai-key-health.js)
    line.textContent = row.text;
    line.classList.toggle('on', row.on);
  });
  showGoogle();
  showTelegram();
  const ext = await window.pilot.extensionInfo();
  showExtensionStatus();
  $('ext-url').textContent = ext.url;
  $('ext-token').textContent = ext.token;
  $('data-folder').textContent = shared.state.folder;
  $('auto-search').checked = shared.state.settings.autoSearch !== false;
  $('open-login').checked = !!shared.state.settings.openAtLogin;
  $('last-search').textContent = shared.state.settings.lastSearchAt
    ? `${runWhen(shared.state.settings.lastSearchAt)}${shared.state.settings.lastSearchOk === false ? t('pagesSetup.withProblems') : ''}`
    : t('pagesCommon.noSearch');
  if (shared.state.settings.telegramBot && shared.state.secrets.TELEGRAM_BOT_TOKEN) {
    const line = document.querySelector('[data-secret="TELEGRAM_BOT_TOKEN"]');
    line.textContent = t('pagesDynamicProfileReady.m301', {"telegramBot": shared.state.settings.telegramBot});
  }
  renderOverview().catch(() => {});
}
// ---------- your details for application forms (the extension asks the app for them) ----------
// The example city is the candidate's own, the date example names its month, and the Swiss "place of origin" shows only for a candidate with Swiss places (renderer/audience.js).
function fitDetailsToCandidate(contact) {
  window.pilot.audience?.().then(answer => {
    const hints = contactHints(answer || {}, contact);
    document.querySelector('[data-contact="location"]').placeholder = hints.locationExample;
    document.querySelector('[data-contact="birth_date"]').placeholder = hints.dateExample;
    const origin = document.querySelector('[data-swiss-only]');
    if (origin) origin.hidden = !hints.showOrigin;
    document.querySelector('[data-contact="github"]').closest('label').hidden = !hints.showGithub;
    showLinks();
  }).catch(() => {});
}
/**
 * Reads Your details' Contact and draws it: the kept copy at once, the fresh read behind it. → the promise of the read (its fresh paint is done when it settles).
 * redraw: true is only Discard all (details-drafts.js repaintContact): the one paint that replaces unsaved edits. Any other paint, the kept copy included, leaves them.
 * Why (pf, 2 Nov 2026; flaky profile-no-draft-on-open "the bar after Fill them in"): the guard below was `!kept && painted && dirty`; a read that started from a kept copy never
 * set `painted` before its fresh paint, so that paint wiped a Fill pressed in between and contactRead() took the wiped boxes as the saved baseline: no draft, no bar, the filled value lost.
 */
export function showContact({redraw = false} = {}) {
  mountContactControls();   // the salutation, date of birth and links as their typed controls (contact-kinds.js)
  // The kept contact fills the boxes at once; with none kept the shared skeleton stands in until it is read (contact-reading.js); never empty boxes that look like lost data.
  let painted = false;   // this call has started the page's other readers (once, at its first fresh paint)
  const read = swr('contact', async () => ({ok: true, contact: (await window.pilot.contact()) || {}}), {
    loading: () => reading(true),
    paint: ({contact}, kept) => {
      reading(false);
      if (redraw || !contactDirty()) {   // a refresh never redraws under unsaved edits (details-drafts.js)
        document.querySelectorAll('[data-contact]').forEach(input => { input.value = contact[input.dataset.contact] || ''; });
        fitDetailsToCandidate(contact);
        showLinks();
        contactRead();   // the drafts count from what is shown now
      }
      if (kept || painted) return;
      painted = true;
      loadProposals();   // the empty boxes, filled in from the CV for you to check (contact-proposals.js)
      showFacts();   // Work eligibility, Availability & compensation, Languages (details-facts.js)
      loadExperienceProfile('details');   // the voluntary survey answers (pages/experience-profile.js)
    },
    fail: result => { reading(false); message('contact-panel-message', `${byStore(t('pagesSetup.readFromNotionFailed'), t('pagesSetup.readProfileFailed'))}: ${result.error}`, 'error'); },   // the panel's line: the save bar's is hidden
  });
  $('contact-cv').textContent = shared.state.settings.cvName || t('pagesCommon.noneYet');
  return read;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  initLetter({openAiSettings: () => openSetting('ai')});
  document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.addEventListener('click', () => profileTab(tab.dataset.profileTab)));
  wireTabLinks(document, profileTab);
  initExperience();
  startOfficeProgress();   // the LibreOffice download for a Word CV, under the CV card (office-progress.js)
  mountProfileMenu($('profile-more'), profileTab);   // Fill from my CV and View source in Notion, quiet in the header (profile-menu.js)
  $('answers-review').addEventListener('click', answersMenu);
  initDetailsRead({contact: contactChangedIn, facts: factsChangedIn});   // Your details read first: summaries, a quiet Edit per card, Done (pages/details-read.js)
  document.addEventListener('details-changed', showLinks);   // the links' tiles follow their fields
  $('answers-add').addEventListener('click', addQuestion);
  renderNotionLinks();
  $('strategy-redo').addEventListener('click', () => { shared.rebuildAsked = true; show($('app'), false); show($('wizard')); goStep('cv'); });
  // An error from the AI service is said in words, never shown as the API's JSON (#94: "400 {"type":"error",…}" sat in the CV card).
  const cvError = (raw, verb) => { const said = humanError(raw); return said === String(raw || '').trim() ? said : t('pagesDynamicProfileReady.m302', {"verb": t(verb === 'show' ? 'pagesDynamicProfileReady.showVerb' : 'pagesDynamicProfileReady.readVerb'), "said": said}); };
  $('cv-view').addEventListener('click', async () => {
    const result = await window.pilot.viewBaseCv();
    $('cv-message').textContent = !result.ok ? cvError(result.error, 'show') : result.overflow?.length ? t('pagesDynamicProfileReady.m303', {"value1": result.overflow.join(', ')}) : '';
  });
  readCvPdf = async () => {
    if ((await window.pilot.cvStatus()).base && !confirm(t('pagesSetup.replaceCvData'))) return;
    $('cv-message').textContent = t('pagesProfile.readingCv');
    const result = await window.pilot.importCv();
    cvReadBlocked = !result.ok && isSpendingLimit(humanError(result.error));
    show($('cv-limit-link'), cvReadBlocked);
    shared.cvReadFailed = !result.ok;
    $('cv-message').textContent = result.ok ? t('pagesShortReady.m266', {"costText": costText(result.usd, usd => ` (${dollars(usd)})`)}) : cvError(result.error, 'read');
    loadCvSetting();
  };
  $('cv-limit-link').addEventListener('click', event => {
    event.preventDefault();
    window.pilot.openExternal('https://console.anthropic.com/settings/limits');
    cvReadBlocked = false;
    show($('cv-limit-link'), false);
  });
  // Long detail cards start closed; the bar shows their summary (owner, 17 Oct 2026). Forms you fill in stay open.
  foldProfilePanels({closed: new Set(['setting-experience-sources', 'setting-details-profile'])});   // every Profile card folds (profile-fold.js); these start closed (the voluntary surveys: optional, owner's review item 5); Work history starts open (owner, 18 Oct 2026, mockup 09)
  initFoldBar();
  $('cvc-run').addEventListener('click', () => cvCheckAction($('cvc-run'), t('pagesExtraLabels.readingCv'), () => window.pilot.cvCheckRun(), checkOptions).then(loadCvSetting));
  $('cvc-ai-run').addEventListener('click', () => cvCheckAction($('cvc-ai-run'), t('pagesExtraLabels.reviewing'), () => window.pilot.cvCheckAi(), checkOptions));
  $('set-telegram-save').addEventListener('click', async () => {
    const value = $('set-telegram').value.trim();
    if (!/^\d+:[\w-]{30,}$/.test(value)) { message('telegram-message', t('pagesSetup.botToken'), 'error'); return; }
    $('set-telegram-save').disabled = true;
    message('telegram-message', t('pagesSetup.checkingToken'));
    const result = await window.pilot.telegramConnect(value);
    $('set-telegram-save').disabled = false;
    if (!result.ok) { message('telegram-message', result.error, 'error'); return; }
    $('set-telegram').value = '';
    message('telegram-message', t('pagesDynamicProfileReady.m304', {"username": result.username}), 'ok');
    loadSettings();
  });
  registerDetails({repaintContact: () => showContact({redraw: true})});   // Contact and the fact sections save through the Profile page's one bar (details-drafts.js)
  guardLeave('settings', proceed => !document.querySelector('.view[data-view="settings"]')?.classList.contains('is-profile') || profileBar().leave(proceed));   // leaving Profile with drafts asks
  showStoreParts();   // every [data-notion-only] in the window (index.html's Notion-only words too), from the start, not only once a Profile tab opens
}
