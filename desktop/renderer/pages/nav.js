import {stageText} from '../jobs-board-rules.js';
import {finalText, paletteGroup} from '../final-pages-copy.js';
// Navigation: pages, ⌘R memory, the ⌘K palette.
import {t} from '../../i18n/index.js';
import {linkedinCommand, linkedinRenewCommand} from './linkedin-consent.js';
import {addGmailCommand} from './gmail-offer.js';
import {addNotifyCommands} from './notify-commands.js';
import {addDesktopAiCommands} from './desktop-ai.js';
import {openPalette} from '../palette.js';
import {openBuild} from './cv-build.js';
import {openImport} from './linkedin-import.js';
import {PROMISE} from '../pro-promise.js';
import {SHOW_I_HAVE_PRO, creditWords} from '../plan-view.js';
import {openQuestionReview} from './question-review.js';
import {buttonEntry, reveal} from './palette-busy.js';
import {paletteEntry as browserOfferEntry} from './browser-offer-rows.js';
import {COMMAND_KIND, KIND, TASK_BUTTONS, kindOf, lastActivity, openActivity, prepareActions, unqueue} from './activity.js';
import {$, show} from './core.js';
import {shared} from './shared.js';
import {scoreQueue} from './score-queue.js';
import {stopShown} from '../session-state.js';
import {knownOutdated, rescoring} from './rescore-run.js';
import {noticeTitle, pressLabel} from '../rescore-words.js';
import {showRunsTab} from './runs-tab.js';
import {showCvChanged} from './cv-change.js';
import {loadFocus} from './focus.js';
import {showFocusStarted} from './focus-onboarding.js';
import {loadCalendar} from './calendar.js';
import {loadInterviews} from './interviews.js';
import {loadEmployers} from './employers.js';
import {closeJobPanel, openJobPanel} from './job-panel.js';
import {leaveView} from './view-leave.js';
import {usage} from '../usage-signals.js';
import {REPORT_TABS, loadReports} from './reports.js';
import {applyViewGate, openInNotion} from './notion-connect.js';
import {fillFromCv} from './profile-menu.js';
import {loadSettings, profileTab} from './profile.js';
import {openSession, renderSessionPage} from './session-log.js';
import {bestSession, renderDock, sessionList} from './sessions.js';
import {openSetting, settingsPage, showServicesNow} from './settings.js';
import {exportState} from './jobs-export.js';
import {ENGINE_CHOICES} from '../ai-engine-view.js';
import {openWaitlist} from './plan-waitlist.js';
import {openTune} from './tune.js';
import {runCommand} from './actions.js';
import {openPromoDialog} from './plan-promo.js';
import {reloadPlan} from './plan.js';
import {showsProWaitlist} from '../plan-line.js';
import {GATED_FEATURES, proGate} from '../pro-gate.js';
import {openProGate} from './pro-upgrade-dialog.js';
import {loadStrategy} from './strategy.js';
import {openCard} from './strategy-cards.js';
import {reviewPreferences} from './job-preferences.js';
import * as viewHistory from '../view-history.js';
import {buildCommands} from './build.js';
import {initMenu, refreshMenu} from './menu.js';
import {FILTER_OPTIONS} from '../jobs-filters.js';
import {setFilters} from './jobs-filter-menu.js';

// ---------- app ----------
// The page (and Settings section) open now, kept for a reload (⌘R): the app comes back where it was.
// sessionStorage: survives a reload of this window, not a restart of the app (that opens Focus as before).
import {remembered} from '../view-memory.js';
export {remembered} from '../view-memory.js';
// Back / forward (⌘← ⌘→, ⌘[ ⌘], the mouse's side buttons): every screen opened through here, in order, and the
// Recent activity panel opened over one (pages/activity.js tells us through panelOpened / panelClosed).
let history = viewHistory.start(null);
export const panelOpened = run => { history = viewHistory.openPanel(history, run); };
export const panelClosed = run => { history = viewHistory.closePanel(history, run); };
// A page with unsaved work can hold a move away (Strategy's draft): guard(proceed) returns true to let it go, or false and calls proceed() later.
const leaveGuards = {};
let currentView = '';
export const guardLeave = (view, guard) => { leaveGuards[view] = guard; };
export function openView(name, {fromHistory = false} = {}) {
  const leaving = currentView;
  if (leaving && leaving !== name && leaveGuards[leaving] && !leaveGuards[leaving](() => { currentView = ''; openView(name, {fromHistory}); })) return;
  leaveView(leaving, name);   // a page stops what runs behind it (the live view's stream on Applying: pages/view-leave.js)
  if (leaving !== name) closeJobPanel();   // the job's drawer covers the page it was opened from: going to another page closes it (a callback that opens a job does openView first)
  currentView = name;
  if (!fromHistory) history = viewHistory.visit(history, name);
  remembered('view', name);
  usage.viewChanged(name);   // seconds on the screen just left (active vs idle) go out; renderer/usage-signals.js
  window.pilot.pageView?.(name).catch?.(() => {});   // the page's name only (a fixed list on the other side), for the usage funnel
  setTimeout(() => { if (typeof renderDock === 'function' && sessionList) renderDock(); }, 0);  // the tray hides on the sessions page
  if (name === 'actions') prepareActions();   // its banner and result card are in the first frame, not a moment later above the tasks (#286)
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  refreshMenu(name);   // a page opened any way (⌘K too) is in the menu from then on
  // Notion later: a page that needs Notion shows only its gate card until it is connected (pages/notion-connect.js); connecting reopens it.
  // Focus without Notion shows its Get started list instead (pages/focus.js showFocusStarted): a fresh setup can search first.
  const started = name === 'focus' && showFocusStarted();
  const locked = !started && applyViewGate(name, {then: () => openView(name, {fromHistory: true})});
  if (name === 'sessions' && !locked) renderSessionPage();  // the view's HTML starts on the spinner; opening it must paint the list we already have
  if (name === 'strategy') { loadStrategy(); showCvChanged(); }
  if (name === 'settings') {
    // Arriving from another page starts on Overview; a move within Settings (sidebar Profile while on Profile, ⌘K "Open Profile: …") never passes
    // through it, or Profile's unsaved-changes question popped up on the way back to Profile itself (test/unit/renderer/profile-page.test.js).
    if (leaving !== 'settings') settingsPage('overview');
    showServicesNow();
    loadSettings();
    window.pilot.dailyTarget().then(setting => { $('set-target').value = $('set-target').dataset.saved = setting.target; $('set-remind').checked = setting.reminders; });
  }
  if (name === 'interviews' && !locked) loadInterviews();
  if (name === 'calendar' && !locked) loadCalendar();
  if (name === 'reports' && !locked) loadReports();
  if (name === 'employers' && !locked) loadEmployers();
  if (name === 'focus' && !locked && !started) loadFocus();
}

// ⌘K / Ctrl+K: the command palette. Its commands are the app's own buttons, read when it opens (so a disabled
// button or a missing Notion link isn't offered); running one opens its page, then clicks it.
const PALETTE_KEYWORDS = {mail: 'email inbox replies confirmations calendar google', run: 'search check jobs find refresh scan crawl',
  tailor: 'tailor cv cover letter resume top matches', visits: 'linkedin indeed glassdoor sites read portals visit extension', board: 'board linkedin sign in login behind read list search',
  scout: 'employers companies discover', status: 'health check', weekly: 'report stats weekly insight review', insight: 'tip advice', kits: 'kits prepare applications cover letter', tune: 'strategy settings roles places tune', ready: 'ready to send overnight night fill forms submit morning',
  today: 'telegram list', applied: 'applications', saved: 'bookmarks starred'};
// A button's own words: the count badge and the dot inside a nav button are not part of its label.
export const labelOf = node => {
  if (!node) return '';
  const copy = node.cloneNode(true);
  copy.querySelectorAll('.nav-badge, .nav-dot, .tab-count').forEach(child => child.remove());   // a tab's count is not its name
  return copy.textContent.replace(/\s+/g, ' ').trim();
};
// A row's path, each step without its leading emoji ("💬 Telegram" → Telegram), a step equal to the one before it once (Settings → Plan, not Plan → Plan).
const pathOf = (...steps) => steps.map(step => String(step || '').replace(/^\P{L}+/u, '').trim()).filter((step, i, all) => step && step !== all[i - 1]);
/** ⌘K "Re-score N": listed only while old scores wait (the Jobs bar's row, rescore-entry.js); asks for the same Re-score dialog, never starts it.
 * Why (5 Nov 2026, arch-check no-circular): an event, not an import of jobs.js / startup.js, which import this page; pages/focus-suggestions.js answers it with the row's own handler. */
/** The Sessions header's two ways out, as ⌘K entries: Stop the extension (always) and Cancel all applications (only while one is unfinished). */
function addSessionExits(addNode) {
  // Why (7 Nov 2026, #2512): only the palette label/hint is localized; choosing this entry still opens Sessions and reveals Stop for 30 s, never presses it (owner, 18 Oct 2026; header reveal, 5 Nov 2026).
  addNode($('ss-stop'), 'Sessions', finalText('nav1'), finalText('nav2'), 'stop freeze halt panic extension chrome everything cancel emergency', () => {
    openView('sessions'); shared.stopPinnedUntil = Date.now() + 30 * 1000; $('ss-stop').hidden = false;
    setTimeout(() => { $('ss-stop').hidden = !stopShown(shared.stopPinnedUntil); }, 30 * 1000 + 100);   // a later reveal moved the pin: the first timer must not hide it early
  });
  if (!$('ss-cancel-all').hidden) addNode($('ss-cancel-all'), 'Sessions', finalText('nav3'), finalText('nav4'), 'cancel all clear every applications sessions stop end close', () => openView('sessions'));
}
/** ⌘K "Score found jobs": listed only while found jobs have no score and no scoring queue runs; the same press as a row's "Score" (an event, as Re-score's: jobs.js answers it). */
function addScoreFoundCommand(add) {
  if (scoreQueue() || !shared.allJobs.some(job => job.fit == null && job.status === 'unreviewed' && !job.place_unclear)) return;
  add('Jobs', t('pagesJobsHelp.queuePalette'), t('pagesJobsHelp.scoreTip'), 'score found jobs unscored fit queue scoring not scored', () => document.dispatchEvent(new Event('score-found-ask')));
}
function addOldScoresCommand(add) {
  const count = knownOutdated().count;
  if (!(count > 0) || rescoring()) return;
  add('Jobs', pressLabel(count), noticeTitle(count), 're-score rescore scores stale previous strategy search settings outdated old',
    () => document.dispatchEvent(new Event('rescore-ask')));
}

export function paletteCommands() {
  const commands = [];
  // A row is a place (a page, card, section, Actions task) or a part of one (kind 'part': a button, a sub-heading); a part folds under its card in ⌘K
  // (palette.js rank). A Settings row also carries its path ("Settings → Connections → Chrome extension"), shown instead of its label.
  const add = (group, label, hint, keywords, run, more = {}) => { if (!label) return null; const command = {group, label, hint, keywords, run, ...more}; commands.push(command); return command; };
  add('Settings', t('common.languageCommand'), finalText('nav5'), 'language Sprache langue lingua idioma limbă язык', () => {
    openView('settings'); settingsPage('overview'); document.getElementById('settings-language')?.focus();
  });
  // A button's ⌘K entry brings you to it and does not press it (owner, 18 Oct 2026: "I don't want necessarily to trigger the action, I just want you to focus
  // on it"): `open` shows its page, then the card scrolls into view, takes focus and pulses (palette-busy.js). A button off only because its task runs is listed too.
  // Every button entry goes through addNode.
  const addNode = (node, group, label, hint, keywords, open, more = {}) => {
    const entry = buttonEntry(node, {group, label, hint, keywords, run: () => { open(); reveal(node); }});
    if (entry) add(entry.group, entry.label, entry.hint, entry.keywords, entry.run, {enter: entry.enter, running: entry.running, kind: 'part', ...more});
    if (entry?.label) commands[commands.length - 1].node = node;   // the probe in palette-every-action.test.js finds a button's entry by its node
  };
  // A button that starts a task an Actions card already offers is that card's twin: one entry per task (6 Oct 2026: "Refresh jobs" and
  // "Check for new jobs" were listed side by side and ran the same jobs check).
  const carded = new Set([...document.querySelectorAll('.action[data-command]')].map(node => COMMAND_KIND[node.dataset.command]).filter(Boolean));
  const twins = new Set(TASK_BUTTONS.filter(([kind]) => carded.has(kind)).flatMap(([, ...selectors]) => selectors.map(s => document.querySelector(s))).filter(Boolean));
  const button = (view, id, keywords, hint = '') => {
    const node = $(id);
    if (node && !twins.has(node) && !node.closest('[hidden]:not(.view)')) addNode(node, view[0].toUpperCase() + view.slice(1), labelOf(node), hint || node.title, keywords, () => openView(view));
  };
  document.querySelectorAll('.nav').forEach(nav => add('Go to', finalText('openName', {name: labelOf(nav)}), '', 'page view', () => nav.click()));
  // The bottom bar's panel is not a page, so the loop above misses it (owner, 7 Oct 2026: "recent" found nothing).
  add('Go to', finalText('nav6'), finalText('nav7'), 'runs recent activity history tasks log results queued failed',
    () => showRunsTab());
  add('Go to', finalText('nav8'), finalText('nav9'), 'current run running now activity details progress log',
    () => { shared.selectedRun = null; openActivity(true); });
  // A card whose Run is off because its task runs or waits (runs-page.js syncRunButtons) is still listed: its entry brings you to the card.
  document.querySelectorAll('.action[data-command]').forEach(node => addNode(node, 'Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.querySelector('span')), PALETTE_KEYWORDS[node.dataset.command], () => openView('actions'), {kind: 'place'}));
  // An action card with its own handler (not a Telegram command): "Tailor CVs" costs minutes of AI, so its entry only brings you to the card.
  document.querySelectorAll('.action[data-palette]').forEach(node => addNode(node, 'Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.closest('.task-body')?.querySelector('.task-words .muted')), PALETTE_KEYWORDS[node.dataset.palette], () => openView('actions'), {kind: 'place'}));
  add('Profile', finalText('nav10'), finalText('nav11'), 'linkedin import profile experience education skills languages update connect', () => openImport());
  add('Profile', finalText('nav12'), finalText('nav13'), 'cv resume build create write new no cv from scratch', () => openBuild());
  // Tune and Analyze left the Actions page (owner, 28 Oct 2026: shown in Focus or Jobs only when they make sense); ⌘K is their one manual door (spec PR 1a).
  add('Strategy', finalText('nav14'), finalText('nav15'), PALETTE_KEYWORDS.tune, () => openTune());
  add('Reports', finalText('nav16'), finalText('nav17'), PALETTE_KEYWORDS.weekly, () => runCommand('weekly'));
  add('Focus', finalText('nav18'), finalText('nav19'), 'suggestions insights tips advice to do calls to action',
    () => { openView('focus'); setTimeout(() => $('focus-suggestions')?.scrollIntoView({block: 'start'}), 300); });
  // The finished Find jobs run's "Find jobs using your browser" (browser-offer.js): brings you to the button on its card.
  const offer = browserOfferEntry({runs: lastActivity?.runs, settings: shared.state?.settings});
  if (offer) add('Actions', offer.label, offer.hint, PALETTE_KEYWORDS.visits, () => { shared.selectedRun = offer.runId; openActivity(true); setTimeout(() => { const go = $('browser-offer-go'); if (go) reveal(go); }, 300); });
  // A task waiting its turn can be taken out of the queue from here too (activity.js unqueue).
  (lastActivity?.queued || []).forEach(run => add('Actions', finalText('removeQueued', {name: KIND[kindOf(run)].name}), finalText('nav20'),
    'unqueue cancel queued waiting remove', () => unqueue(run)));
  // Every tracked job's page (pages/job-panel.js): its kit, prep, reviews, record, messages and history, found by its title or company.
  (shared.allJobs || []).filter(job => job.stage && job.url).forEach(job => add('Jobs', finalText('openJob', {title: job.title, company: job.company}), stageText(job.stage),
    'job page kit cover letter form answers prep review record messages description history', () => { openView('jobs'); openJobPanel(job); }));
  // The job's Documents tab (tailored CV + cover letter): a job with a kit or a tailored CV, opened straight on that tab.
  (shared.allJobs || []).filter(job => job.url && (job.kit || job.tailored)).forEach(job => add('Jobs', finalText('openDocs', {title: job.title, company: job.company}), finalText('nav21'),
    'documents tailored cv cover letter files pdf', () => { openView('jobs'); openJobPanel(job, 'documents'); }));
  // Jobs → List | Board and every filter of the Show menu (jobs-filters.js), so a new filter is listed by itself.
  document.querySelectorAll('[data-mode]').forEach(node => add('Jobs', finalText('showJobs', {mode: labelOf(node).toLowerCase()}), node.dataset.mode === 'board'
    ? finalText('nav22') : finalText('nav23'), 'pipeline kanban board columns stages list', () => { openView('jobs'); node.click(); }));
  // Export job list (Pro, pages/jobs-export.js): the Jobs button opens its menu; a free user is taken to the Plan card once Pro is on at the site.
  const exporting = exportState(shared.licenseState || {});
  add('Jobs', finalText('nav24'), exporting === 'open' ? finalText('nav25') : finalText('nav26'), 'export download save csv json excel spreadsheet jobs list pro',
    () => { if (exporting === 'locked') return openProGate(); openView('jobs'); setTimeout(() => $('jobs-export').click(), 150); }, exporting === 'locked' ? {badge: ['Pro']} : {});
  FILTER_OPTIONS.forEach(option => add('Jobs', finalText('jobsFilter', {label: option.label}), option.title,
    'show menu filter saved views applications active applying in progress rejected this week', () => { openView('jobs'); setFilters([option.id]); document.dispatchEvent(new CustomEvent('jobs-rerender')); }));
  // Each Reports tab (pages/reports.js), by what it holds.
  for (const [tab, label, words] of REPORT_TABS) add('Reports', finalText('openReports', {label}), '', words, () => { openView('reports'); loadReports(tab); });
  // The AI engine's choices (pages/ai-engine.js): open Settings → Connections → AI and press the card, as by hand.
  const press = (choice, wait) => setTimeout(() => document.querySelector(`#ai-engine-settings [data-choice="${choice}"]`)?.click(), wait);
  for (const [choice, label, hint, words, family] of ENGINE_CHOICES) add('Settings', label, hint, `ai engine ${words}`, () => {
    openSetting('ai'); if (family) press(family, 300); press(choice, family ? 700 : 300);
  });
  // The Pro plan (pages/plan.js), only when the site's plan is on: the Plan card in Settings → Plan.
  if (['test', 'live'].includes(shared.plan?.mode)) {
    const goPlan = () => { openSetting('plan'); };
    if (shared.plan.plan === 'pro') {
      if (shared.plan.package === 'pro') add('Settings', finalText('nav27'), finalText('nav28'), 'pro ai upgrade credit plan buy pay difference', goPlan);
      add('Settings', finalText('nav29'), finalText('nav30'), 'pro plan credit ai balance license', goPlan); add('Settings', finalText('nav31'), finalText('topup', {offers: (shared.plan.offers || []).filter(o => o.id.startsWith('topup')).map(o => `€${o.price}`).join(', ') || finalText('topupFallback')}), 'pro top up topup credit buy ai more', goPlan);
    } else {
      add('Settings', finalText('nav32'), PROMISE, 'pro upgrade plan price buy pay unlimited license', goPlan);
      add('Settings', finalText('nav33'), finalText('proIncluded', {promise: PROMISE, credit: creditWords((shared.plan.offers || []).find(o => o.id === 'pro-ai')) || finalText('aiCredit')}), 'pro ai upgrade plan price buy pay credit unlimited license', goPlan);
      if (SHOW_I_HAVE_PRO) add('Settings', finalText('nav34'), finalText('nav35'), 'pro sign in signin code add device computer have', () => { goPlan(); setTimeout(() => $('plan-have-pro')?.click(), 300); });
    }
  }
  // A promo code gives Pro with paying on or off (renderer/pro-gate.js): shown to everyone who is not Pro yet.
  if (GATED_FEATURES.promo(proGate(shared.licenseState || {})).shown) add('Settings', finalText('nav36'), finalText('nav37'), 'promo code redeem pro voucher coupon gift free', () => openPromoDialog(reloadPlan));
  // Pro is not open yet: the Pro card on the Plan page, and its waitlist (pages/plan-waitlist.js).
  if (showsProWaitlist(shared.licenseState || {}) && !shared.state?.settings?.proWaitlist?.email) add('Settings', finalText('nav38'), finalText('nav39'), 'pro waitlist early access upgrade plan price join email', () => { openSetting('license'); setTimeout(openWaitlist, 150); });
  addSessionExits(addNode);
  button('jobs', 'refresh', 'find jobs scan');
  addOldScoresCommand(add);
  addScoreFoundCommand(add);
  button('employers', 'emp-paste', 'add employers companies paste page text address list newsletter portfolio talent agent matches startups');
  // The two drawers, one question at a time (pages/question-review.js; owner, 28 Oct 2026): the same drawers as Jobs' cards and the Profile tabs.
  add('Jobs', finalText('nav40'), finalText('nav41'), 'questions missing facts details contact name email phone notice period permit eligibility languages fill',
    () => openQuestionReview({queue: 'details'}));
  add('Jobs', finalText('nav42'), finalText('nav43'), 'questions answers review learned reusable suggested forms application what we learned check',
    () => openQuestionReview({queue: 'learned'}));
  button('strategy', 'open-profile', 'edit roles locations places cities country skills targeting preferences');
  // Strategy → Job preferences (pages/job-preferences.js; was Profile → Preferences, 17 Oct 2026): the card, and its Review button.
  add('Strategy', finalText('nav44'), finalText('nav45'), 'deal-breakers must-haves preferences ranking on-call industries workload',
    () => { openView('strategy'); setTimeout(() => $('strategy-job-prefs')?.scrollIntoView({block: 'start'}), 300); });
  // Strategy → Locations (pages/locations-card.js): preferred, acceptable, relocation, remote work; the reset only while a search-only list is active.
  const locationsCard = () => { openView('strategy'); setTimeout(() => document.querySelector('#strategy-locations [data-list="places"]')?.scrollIntoView({block: 'start'}), 300); };
  // Strategy → Main goals (pages/main-goals.js) opens its editor; Advanced search settings unfolds (owner, 18 Oct 2026, mockup 03).
  add('Strategy', finalText('nav46'), finalText('nav47'), 'goals target roles job titles job board searches search terms level seniority work mode remote hybrid minimum salary compensation',
    () => { openView('strategy'); setTimeout(() => { openCard('goals'); $('strategy-main-goals')?.scrollIntoView({block: 'start'}); }, 300); });
  add('Strategy', finalText('nav48'), finalText('nav49'), 'advanced skills stack exclusions languages skip companies titles google digest minimum score',
    () => { openView('strategy'); setTimeout(() => { const box = $('strategy-advanced'); if (box) { box.open = true; box.scrollIntoView({block: 'start'}); } }, 300); });
  add('Strategy', finalText('nav50'), finalText('nav51'), 'locations places cities countries relocation remote preferred acceptable search coverage', locationsCard);
  if (shared.coverageActive) add('Strategy', finalText('nav52'), finalText('nav53'), 'reset search coverage override custom locations places', locationsCard);
  // Review your preferences lives in Job preferences' editor: opened first, then the AI reads the fields (pages/job-preferences.js).
  add('Strategy', finalText('nav56'), finalText('nav57'), 'job preferences review clean values ai',
    () => { openView('strategy'); setTimeout(() => { openCard('prefs'); reviewPreferences(); $('strategy-job-prefs')?.scrollIntoView({block: 'start'}); }, 300); });
  button('jobs', 'apply-open', 'apply fill forms');
  button('jobs', 'add-open', 'add new job application message update recruiter');
  // The three flows behind "+ Add" keep their own entries (their openers are out of sight, so the sweep above skips them): each opens its flow directly.
  [['import-open', finalText('addJob'), finalText('addJobHint'), 'add job link paste posting'],
   ['applied-open', finalText('addApplication'), finalText('addApplicationHint'), 'track add application applied elsewhere outside'],
   ['lead-open', finalText('addMessage'), finalText('addMessageHint'), 'log activity recruiter message email screenshot update']]
    .forEach(([id, label, hint, keywords]) => add('Jobs', label, hint, keywords, () => { openView('jobs'); $(id).click(); }));
  button('interviews', 'iv-add', 'upload audio video transcript file');
  button('interviews', 'iv-record', 'start call audio', finalText('nav58'));
  button('interviews', 'iv-recordings', 'files folder finder');
  // Settings: every page, every section (by its heading) and every button in a section, read from the page itself so a new one is listed without being
  // added here (6 Oct 2026: Export and Import data were not in ⌘K). A section opens its page and scrolls to it; a button does that and brings you to the button
  // (focus and a pulse) without pressing it.
  const pages = new Set();   // one entry a page: Overview's shortcuts ("Manage automation") lead to a page already listed
  document.querySelectorAll('[data-settings-go]').forEach(go => {
    if (pages.has(go.dataset.settingsGo)) return;
    pages.add(go.dataset.settingsGo);
    add('Settings', finalText('openSettings', {label: labelOf(go)}), '', 'settings preferences', () => { openView('settings'); go.click(); }, {path: pathOf(paletteGroup('Settings'), labelOf(go))});
  });
  // Connections are drawn as service cards (settings.js renderConnections): each one's Manage or Connect.
  document.querySelectorAll('#conn-on .service-card, #conn-off .service-card').forEach(card => {
    const name = labelOf(card.querySelector('.service-text b')), node = card.querySelector('button');
    if (name && node) addNode(node, 'Settings', `${name}: ${labelOf(node)}`, labelOf(card.querySelector('.service-text .muted')), 'settings connections connect', () => { openView('settings'); settingsPage('connections'); },
      {card: `setting-${card.dataset.service}`, part: labelOf(node)});   // a part of its connection's card (settings.js data-service), linked below
  });
  // LinkedIn jobs (owner, 31 Oct 2026: "Register it in ⌘K"): the action itself, not only its Settings card; the consent behind every door.
  const linkedin = linkedinCommand();
  add('Settings', linkedin.label, linkedin.hint, linkedin.keywords, linkedin.run);
  const renew = linkedinRenewCommand();   // #3911: the way to renew a dead LinkedIn sign-in
  if (renew) add('Settings', renew.label, renew.hint, renew.keywords, renew.run);
  addGmailCommand(add);   // only while Gmail is not connected (owner, 2 Nov 2026)
  addNotifyCommands(add);   // only while no e-mail or Telegram works (owner, 2 Nov 2026)
  addDesktopAiCommands(add);   // only while the Claude or ChatGPT desktop app is here and What we learned has open questions (owner, 2 Nov 2026)
  const hiddenAt = node => node.closest('[hidden]:not(.view):not([data-settings-page])');
  const shown = node => !hiddenAt(node);
  // A Profile section is hidden only because its tab is closed: still listed, and its entry opens that tab first (17 Oct 2026: CV and Your details split).
  const openTab = () => document.querySelector('[data-profile-tab].is-active')?.dataset.profileTab;
  const onClosedTab = section => !!section.dataset.profilePanel && section.dataset.profilePanel !== openTab() && hiddenAt(section) === section
    && !hiddenAt(section.parentElement);
  // A connection's card (Settings → Connections → Manage: Chrome extension, Telegram, ...) is hidden until chosen: listed too, its entry opens it (settings.js openSetting).
  // A parked feature's card (data-parked, src/features.py PARKED) is never listed: it stays hidden until the feature is back.
  const onClosedPanel = section => section.classList.contains('conn-panel') && !section.dataset.parked && hiddenAt(section) === section && !hiddenAt(section.parentElement);
  const reachable = (node, section) => shown(node) || ((onClosedTab(section) || onClosedPanel(section)) && hiddenAt(node) === section);
  document.querySelectorAll('[data-profile-tab]').forEach(tab => add('Settings', finalText('openProfile', {label: labelOf(tab)}), '', 'settings profile tab',
    () => { openView('settings'); settingsPage('profile'); profileTab(tab.dataset.profileTab); }, {path: pathOf(paletteGroup('Profile'), labelOf(tab))}));
  // The Profile ⋯ menu's two actions (pages/profile-menu.js; UI redesign fix 10, 18 Oct 2026).
  add('Settings', finalText('nav59'), finalText('nav60'), 'profile details contact cv fill empty phone address',
    () => { openView('settings'); settingsPage('profile'); fillFromCv(profileTab); });
  if (shared.state?.notion?.NOTION_PROFILE_PAGE_ID) add('Notion', finalText('nav61'), '', 'notion profile page open source', () => openInNotion('NOTION_PROFILE_PAGE_ID'), {kind: 'part'});   // about Notion
  const seen = new Set();
  // A Settings page's name: its side-menu button; Profile has none there (it is a page of the main menu), so it is named here.
  const pageName = page => page === 'profile' ? paletteGroup('Profile') : labelOf(document.querySelector(`[data-settings-go="${page}"]`));
  // Where a Settings row sits: Settings → its page (Profile → its tab) → its name.
  const placeOf = (section, page) => page === 'profile'
    ? [paletteGroup('Profile'), labelOf(document.querySelector(`[data-profile-tab="${section?.dataset.profilePanel}"]`))] : [paletteGroup('Settings'), pageName(page)];
  const cards = new Map();
  document.querySelectorAll('[data-settings-page] .setting[id]').forEach(section => {
    // A summary's own heading, not its whole line; a card with none is named by its bold line (Current CV) or its page (Credentials, Logs).
    const title = labelOf(section.querySelector('h3') || section.querySelector('h4, summary') || section.querySelector('.cv-card-text b')) || pageName(section.closest('[data-settings-page]')?.dataset.settingsPage);
    if (!reachable(section, section) || !title || seen.has(title)) return;
    seen.add(title);
    const page = section.closest('[data-settings-page]').dataset.settingsPage;
    const open = () => {
      openView('settings'); settingsPage(page);
      if (section.dataset.profilePanel) profileTab(section.dataset.profilePanel);
      if (section.classList.contains('conn-panel')) openSetting(section.id.replace(/^setting-/, ''));
      if (section.tagName === 'DETAILS') section.open = true;
      section.scrollIntoView({block: 'start'});
    };
    const place = add('Settings', title, '', `settings ${page}`, open, {alias: section.dataset.keywords || '', path: pathOf(...placeOf(section, page), title)});   // data-keywords: the words a person types for it ("email" finds Notifications)
    cards.set(section.id, place);
    // The section's own sub-headings ("Chrome extension: manual connection" inside Developer options), each its own entry; never a field's value.
    section.querySelectorAll('h3, h4').forEach(heading => {
      const name = labelOf(heading);
      if (!name || seen.has(name) || !reachable(heading, section)) return;
      seen.add(name);
      add('Settings', name, finalText('section', {title}), `settings ${page}`, () => { open(); reveal(heading); }, {node: heading, kind: 'part', parent: place, path: [...place.path, name]});
    });
    const buttons = [...section.querySelectorAll('button[id]')].filter(node => reachable(node, section) && !twins.has(node));
    buttons.forEach(node => {
      const danger = !!node.closest('.danger-zone') || /danger/.test(node.className);
      if (danger && buttons.length === 1) return;   // a section's sole danger button lands where its own entry does: a duplicate row
      addNode(node, 'Settings', `${title}: ${labelOf(node)}`, node.title, `settings ${page}`, open, {parent: place, path: [...place.path, labelOf(node)]});
    });
  });
  // Headings on a Settings page that sit outside a section with an id (Overview's "Your setup", Connections' "Connected"): the page opens, the heading flashes.
  document.querySelectorAll('[data-settings-page] :is(h2, h3, h4)').forEach(heading => {
    const name = labelOf(heading), page = heading.closest('[data-settings-page]').dataset.settingsPage;
    if (!/\p{L}{2}/u.test(name) || seen.has(name) || heading.closest('.setting[id]') || hiddenAt(heading) || heading.closest('dialog, [role="dialog"]')) return;
    seen.add(name);
    add('Settings', name, finalText('section', {title: pageName(page)}), `settings ${page}`, () => { openView('settings'); settingsPage(page); reveal(heading); }, {node: heading, path: pathOf(...placeOf(null, page), name)});
  });
  // A connection card's Manage or Connect is a part of that connection's card (Settings → Connections → Chrome extension → Manage).
  for (const command of commands) if (cards.has(command.card)) Object.assign(command, {parent: cards.get(command.card), path: [...cards.get(command.card).path, command.part]});
  document.querySelectorAll('#notion-links:not([hidden]) .notion-link').forEach(link => add('Notion', `Notion: ${labelOf(link)}`, '', 'open page database', () => link.click(), {kind: 'part'}));   // about Notion: parts of Notion
  // Every other button a page shows (a Refresh, "Edit in Notion", "Fill now"): found by sweeping each page, so a new button is listed without being added here
  // (18 Oct 2026: Chrome extension was missing from ⌘K; palette-every-action.test.js fails on any button left out). Buttons in a dialog, hidden by their state
  // or already listed are skipped; Settings has its own sweep above.
  const listed = new Set(commands.map(command => command.node).filter(Boolean));
  document.querySelectorAll('.view:not([data-view="settings"]) button[id]').forEach(node => {
    const view = node.closest('.view').dataset.view, page = view[0].toUpperCase() + view.slice(1), label = labelOf(node) || node.getAttribute('aria-label') || '';
    if (listed.has(node) || twins.has(node) || node.closest('dialog, [role="dialog"], [hidden]:not(.view)') || !/\p{L}{2}/u.test(label)) return;
    addNode(node, page, `${paletteGroup(page)}: ${label}`, node.title, `${view} page`, () => openView(view));
  });
  // Every card and section heading on the other pages (Focus' Insight, Reports, Calendar's Coming up): the card scrolls into view and flashes.
  const named = new Set(commands.map(command => `${command.group}|${command.label}`));
  document.querySelectorAll('.view:not([data-view="settings"]) :is(h2, h3, h4)').forEach(heading => {
    const view = heading.closest('.view').dataset.view, page = view[0].toUpperCase() + view.slice(1), name = labelOf(heading);
    if (!/\p{L}{2}/u.test(name) || named.has(`${page}|${name}`) || heading.closest('dialog, [role="dialog"], [hidden]:not(.view)')) return;
    named.add(`${page}|${name}`);
    add(page, name, finalText('card', {page: paletteGroup(page)}), `${view} page card section`, () => { openView(view); reveal(heading); }, {node: heading});
  });
  for (const command of buildCommands()) add(command.group, command.label, command.hint, command.keywords, command.run);   // Restart to get N fixes (pages/build.js)
  return commands;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
function go(way) {
  if (!$('activity-panel').hidden) history = viewHistory.withRun(history, shared.selectedRun);   // forward to it again shows the same run
  const step = way === 'back' ? viewHistory.back(history) : viewHistory.forward(history);
  if (!step.name) return;
  const [from, to] = [viewHistory.step(history.list[history.at]), viewHistory.step(step.name)];
  history = step.history;
  if (to.view !== from.view || !to.panel) openView(to.view, {fromHistory: true});   // the panel's own step: the screen under it is already there
  if (to.panel) shared.selectedRun = to.run;
  openActivity(to.panel, {fromHistory: true});
}
const editable = target => !!target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm');

export async function init() {
  const mac = /Mac/.test(navigator.platform);
  document.addEventListener('keydown', event => {
    const way = viewHistory.navKey(event, {mac, editable: editable(event.target)});
    if (way) { event.preventDefault(); go(way); }
  });
  document.addEventListener('mouseup', event => {  // the mouse's side buttons: 3 back, 4 forward
    if (event.button === 3 || event.button === 4) { event.preventDefault(); go(event.button === 3 ? 'back' : 'forward'); }
  });
  document.querySelectorAll('.nav').forEach(nav => {
    nav.title ||= nav.textContent.trim();  // the label, when the narrow window shows the sidebar as icons only
    nav.addEventListener('click', () => {
      // A button of the menu that is not a page ("Send feedback" opens its own dialog; the wizard's "Stuck? Tell us"): it has no view to open.
      // Opening "no view" hid every page and left the window blank behind the dialog (a friend's first feedback, 2 Oct 2026).
      if (!nav.dataset.view) return;
      // Applying opens the session that needs you most (else the latest), not just the page.
      if (nav.dataset.view === 'sessions' && bestSession()) return openSession(bestSession().id);
      openView(nav.dataset.view);
      if (nav.dataset.view === 'settings') settingsPage(nav.dataset.settings || 'overview');   // the sidebar's Settings is its Overview, also from Profile
    });
  });
  initMenu();   // pages/menu.js: the pages that appear when used, the More row, the first-launch tour
  // The sessions line at the foot does the same as Applying.
  $('nav-sessions').addEventListener('click', () => document.querySelector('.nav[data-view="sessions"]').click());
  $('palette-hint').addEventListener('click', () => openPalette(paletteCommands()));
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if ($('app').hidden) return;  // the setup wizard has nothing to run yet
    event.preventDefault();
    // Open or closed, not present or absent: a closed palette is removed a moment later (its close event), and ⌘K pressed in between did nothing (Linux/Windows CI, 6 Oct 2026).
    if ($('palette')?.open) $('palette').close(); else openPalette(paletteCommands());
  });
}
