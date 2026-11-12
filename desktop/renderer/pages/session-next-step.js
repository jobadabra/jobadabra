import {date as displayDate} from '../../i18n/format.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {silentChromeButtons} from './silent-chrome.js';
// The next-step card of an application session (the decision card: its state, Claude's question, the form's needs, what happened, the actions), moved out of sessions.js
// as a pure move (13 Oct 2026) so both files stay one concern under 500 lines. The session list and its shared state stay in sessions.js and are imported from it (a cycle, as
// session-log.js already has: nothing here runs at load). Guards read this file's source: desktop/test/claude-offer, claude-help, claude-safety-net, session-state,
// session-optional, resume-secondary and terminals tests.
import {ai} from '../ai-name.js';
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {PROBLEM, isDevTalk, latestStep, readSessionMessage, sortChecks, splitLabel} from '../session-message.js';
import {accountProgress, askOutdated, linkOffLine, pageLine, asksYou, leftForYou, firstLine, isLive, isSubmitted, panelAnswered, sessionReview, sessionStage, accountRecordLine} from '../session-state.js';
import {resumeOffered} from '../claude-help.js';
import {offerParts} from '../claude-offer.js';
import {$, show} from './core.js';
import {actionButton, drawActions} from './action-row.js';
import {shared} from './shared.js';
import {initOptional, showOptional} from './session-optional.js';
import {jobsChanged} from './jobs.js';
import {richText} from './rich-text.js';
import {openSession, renderSessionPage, say} from './session-log.js';
import {applyFormStates, askRow, reviewStates, opening, openForm, reopenClosedTab, checkingTab, redirecting, silentChrome, waitingChrome, tabLost, formGone, formReady, emptyFields, emptyRow, explainExtension, needRow, showFormState, updateNeedsCount, watchAgreements} from './session-needs.js'; import {showSendBar} from './need-send.js';
import {toastMessage} from './startup.js';
import {pauseSession, removeSession, restartSession, resumeSession, skipSession} from './session-actions.js';
import {closeLive, renderLive} from './session-live.js';
import {storeName} from '../store-words.js';
import {INFORM_STUCK} from '../session-steps-list.js';
import {openLog, refreshSessions, sessionCompany, sessionJob, sessionTail, ticking} from './sessions.js';
import {NO_PLACE, sessionPlace} from '../targets.js';

// Sessions whose form page has just failed to answer the app: only those are offered the "Reload the tab" repair
// (it reloads a form page, so it must not sit in the row by default). Cleared when the page answers again.
const panelDead = new Set();
const hhmmOf = iso => displayDate(new Date(iso), {hour: '2-digit', minute: '2-digit'});
const sessionButton = actionButton;
// A row that shows one line and unfolds the rest on click (a › that turns).
function foldRow(short, more) {
  const li = el('li', 'ss-check');
  const line = el('div', 'ss-check-line');
  const words = el('span', 'ss-check-text');  // one flow of text (a `code` chip would otherwise be its own column)
  words.append(...richText(short).flatMap(node => [...node.childNodes]));
  line.append(icon('chevron'), words);
  li.append(line);
  if (!more) return li;
  const detail = el('div', 'muted small ss-check-more');
  detail.append(...richText(more));
  detail.hidden = true;
  li.classList.add('has-more');
  li.addEventListener('click', () => { detail.hidden = !detail.hidden; li.classList.toggle('is-open', !detail.hidden); });
  li.append(detail);
  return li;
}
let fullFor = null, reportFor = null;  // the session whose Claude's message the banner shows (folded again for another one)
// "I submitted it": you sent the application and the app missed it (the Jobs row and Notion move to Applied). On every
// unsubmitted state of a session, so a missed submit can always be put right by hand.
const submittedButton = item => sessionButton(t('pagesSession.iSubmitted'), 'secondary', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  const result = await window.pilot.setStatus(item.url, 'applied').catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { button.disabled = false; toastMessage(t('pagesSession.notMarked'), result.error || t('pagesCommon.tryAgain'), sessionPlace(item), 'bad'); return; }
  jobsChanged(sessionJob(item), {stage: 'Applied', status: 'applied'});   // its Jobs row too, not only this button
  button.textContent = t('pagesSession.marked');
}, 'check');
// Where to answer: the button opens the reply box in the log below (a quick reply there sends one tap of text).
const answerHint = () => el('p', 'rich-p muted small', t('pagesSessionHelp.answerLog'));
// While the app checks Chrome for the session's tab: a loading card (the existing .skeleton lines), nothing from the last state.
function renderChecking() {
  $('ss-decision').className = 'ss-next tone-neutral';
  $('ss-next-title').textContent = t('pagesSession.checkingChrome');
  $('ss-next-state').textContent = '';
  $('ss-stage').replaceChildren();
  $('ss-form-state').replaceChildren();
  $('ss-question').replaceChildren(el('span', 'skeleton w-80'), el('span', 'skeleton w-60'));
  $('ss-actions').replaceChildren(el('span', 'skeleton button'), el('span', 'skeleton button small'));
  for (const id of ['ss-form-card', 'ss-needs-card', 'ss-happened-card', 'ss-optional-card', 'ss-full-toggle', 'ss-full']) show($(id), false);
}
// Chrome hasn't reported (closed, or the extension isn't running): the card can't know the tab, so it says that, with the way
// back (the extension's own page, which starts it reporting); it updates by itself once Chrome reports.
const START_MS = 30 * 1000;   // as lib/chrome-launch-once.js: how long one press keeps the button on "Starting Chrome…"
// The app only just started: Chrome has had no time to report, so a neutral wait with the same way back, no warning.
function renderWaiting() {
  renderChecking();
  $('ss-next-title').textContent = t('pagesSession.waitingChrome');
  $('ss-question').replaceChildren(el('p', 'rich-p', t('pagesSessionHelp.justStarted')));
  $('ss-actions').replaceChildren();   // nothing to press while it waits
}
// The tab is on a posting whose Apply the extension presses (or just pressed): nothing else of the session is true for this page, so no counts, no ready, no asks (owner, 15 Oct 2026).
function renderRedirecting(item) {
  renderChecking();
  $('ss-next-title').textContent = pageLine(reviewStates.get(item.id)?.page);
  $('ss-question').replaceChildren();
  $('ss-actions').replaceChildren();
}
function renderSilent(item) {
  renderChecking();
  $('ss-decision').className = 'ss-next tone-warn';
  const off = shared.formsOpen?.linkOff;
  if (off) {   // Why (29 Oct 2026, owner): the app's own socket is not open, so Chrome can't report; "Open Chrome" would fix nothing (renderer/session-state.js chromeSilent)
    $('ss-next-title').textContent = t('pagesSession.cannotHear');
    $('ss-question').replaceChildren(el('p', 'rich-p', linkOffLine(off)));
    $('ss-actions').replaceChildren();
    return;
  }
  $('ss-next-title').textContent = t('pagesSession.notReporting');
  const starting = Date.now() - shared.chromeStartedAt < START_MS;
  const retried = shared.chromeStartedAt && !starting;   // pressed before, and Chrome still has not reported
  $('ss-question').replaceChildren(el('p', 'rich-p', retried ? t('pagesSessionHelp.chromeTimeout')
    : t('pagesSessionHelp.chromeInvisible')));
  const connect = sessionButton(starting ? t('pagesSession.startingChrome') : t('pagesSession.openChrome'), 'secondary', async event => {
    const result = await opening(event.currentTarget, () => window.pilot.extensionOptions());
    window.pilot.uiLog('sessions: Chrome not reporting, Open Chrome pressed', {opened: !!result?.opened, starting: !!result?.starting});
    if (!result?.opened) { toastMessage(t('pagesSession.chromeFailed'), t('pagesSessionHelp.openYourself'), NO_PLACE.outside, 'bad'); return; }
    shared.chromeStartedAt = result.since || Date.now();
    renderNextStep(item);
    setTimeout(() => { if (silentChrome(item)) renderNextStep(item); }, START_MS + 100);   // offered again, with the reason
  }, 'link');
  if (starting) connect.disabled = true;
  // Why (29 Oct 2026, owner: the Open Chrome press sent a connected extension to its settings page and never opened the job): with a job URL the card reopens that job's form; Open Chrome stays as the link that connects the extension.
  const reopen = reopenButton(item);
  drawActions($('ss-actions'), silentChromeButtons(item).map(kind => kind === 'reopen' ? reopen : connect));
}
// The first look is over and no tab is known for the session: it says so and offers the one way forward, the same reopen every closed-tab button uses.
// The reopen of a session's form: the one button both the lost-tab card and the silent card (Chrome not reporting) draw.
function reopenButton(item) {
  return sessionButton(t('pagesSession.openAgain'), 'primary', event => reopenClosedTab(item, event.currentTarget), 'link');
}
function renderLost(item) {
  renderChecking();
  $('ss-decision').className = 'ss-next tone-warn';
  $('ss-next-title').textContent = t('pagesSession.tabMissing');
  $('ss-question').replaceChildren(el('p', 'rich-p', t('pagesSessionHelp.tabLost')));
  drawActions($('ss-actions'), [reopenButton(item)]);
}
/** The stopped card's line in the person's language, from the origin the journey stored (lib/application-journey.js stopSource); a session saved before it had one reads neutral.
 * Why (#3410, owner 7 Nov 2026: "Yes, ship it (Recommended)" on the preview): only an explicit Stop press says "by you". */
const STOP_HELP = {user: 'stoppedByYou', browser: 'stoppedByChrome'};
const stopHelp = item => t(`pagesSessionHelp.${STOP_HELP[item.stopSource] || 'stoppedNeutral'}`);

export function renderNextStep(item) {
  // A hidden-browser session (spec 2026-10-27-background-apply-execution, step B) has no Chrome tab of the person's: its card is the live page.
  if (item.background && !isSubmitted(item)) {
    renderLive(item, {open: () => restartSession(item), skip: () => skipSession(item), problem: (title, text) => toastMessage(title, text, sessionPlace(item), 'bad')});
    show($('ss-full-toggle'), false); $('ss-full').hidden = true;
    const {checks, needs: forYou, audit, done} = readSessionMessage(item.question);
    renderCards(item, {checks, forYou, audit, done, review: true, asking: false, gone: false});
    return;
  }
  closeLive();
  if (checkingTab(item)) { renderChecking(); return; }
  if (waitingChrome(item)) { renderWaiting(); return; }
  if (redirecting(item)) { renderRedirecting(item); return; }
  if (silentChrome(item)) { renderSilent(item); return; }
  if (tabLost(item)) { renderLost(item); return; }
  const submitted = isSubmitted(item);
  // Its Chrome tab was closed: that wins over "can't reach this form" (nothing to reach) and over what Claude last asked (about that tab).
  const stopped = !submitted && item.kind === 'form' && item.stuck === 'stopped';   // the person pressed Stop: Reopen form starts it again
  const gone = !submitted && formGone(item);
  const stuck = !submitted && item.kind === 'form' && !!item.stuck && !gone && !stopped;   // the extension can't reach this form
  // Claude closed with the app, and the form's own tab since reported an application page with fields: the frozen ask is outdated, the live page leads (owner, 15 Oct 2026).
  const liveForm = reviewStates.get(item.id), outdatedAsk = !submitted && askOutdated(item, liveForm);
  const review = !submitted && !stuck && !stopped && sessionReview(item, formReady(item)), asking = !submitted && !stuck && !stopped && !review && !outdatedAsk && (item.status === 'input' || (item.status === 'done' && item.kind !== 'form' && !item.inChrome && leftForYou(item))), running = !submitted && item.status === 'running';
  const open = !submitted && !stuck && !stopped && !review && !asking && (item.kind === 'form' || item.inChrome || outdatedAsk) && (item.status === 'done' || outdatedAsk);
  const {checks, needs: forYou, audit, done, intro} = readSessionMessage(submitted ? '' : item.question);
  const tone = submitted ? 'good' : review || asking || stuck || stopped ? 'warn' : running ? 'info' : item.status === 'failed' ? 'bad' : 'neutral';
  $('ss-decision').className = `ss-next tone-${tone}`;
  const brief = item.brief || '';
  const ask = asksYou(item) && /\?$/.test(brief) ? brief : '';
  $('ss-next-title').textContent = submitted ? t('pagesSession.submitted')
    : stuck ? (item.stuck === 'account' ? (item.accountStep === 'sign_in' ? t('pagesDynamicSessionReports.m364', {"value1": item.accountHost ? t('pagesDynamicSessionReports.toHost', {host: item.accountHost.replace(/^www\./, '')}) : ''}) : t('pagesSession.siteAccount')) : item.stuck === 'incomplete' ? t('pagesSession.nothingFilled') : item.stuck === 'email' ? t('pagesSession.sendByEmail') : item.stuck === 'told' ? t('pagesSession.pageInstructions') : item.stuck === 'other' ? t('pagesSession.cannotTell') : item.stuck === 'site_broken' ? t('pagesSession.siteNoAnswer') : t('pagesSession.cannotReach'))
    : stopped ? t('pagesSession.extensionStopped')
    : gone ? t('pagesSession.formClosed')
    : review ? t('pagesSession.reviewFilled')
    : asking ? ask || (item.stage === 'account' ? t('pagesSession.accountInput') : t('pagesSession.applicationInput'))
    : open ? t('pagesSession.completeChrome')
    : running ? ai(t('pagesAuditPunct.a55')) : item.status === 'failed' ? t('pagesSession.sessionStopped') : t('pagesSession.sessionEnded');
  // Its state, after the title: finished (when), waiting (since when) or working (for how long).
  const since = item.needsYouSince || item.endedAt || item.startedAt;
  const state = $('ss-next-state');
  state.textContent = submitted ? t('pagesDynamicSessionReports.m365', {"hhmmOf": hhmmOf(since)})
    : stuck ? (item.stuck === 'account' ? accountProgress(reviewStates.get(item.id)) : INFORM_STUCK.includes(item.stuck) ? '' : t('pagesAuditThird.a187'))
    : review ? (item.kind === 'form' || item.inChrome ? t('pagesDynamicSessionReports.m366', {"hhmmOf": hhmmOf(since)}) : ai(t('pagesDynamicSessionReports.m367', {"hhmmOf": hhmmOf(since)}))) : asking ? (isLive(item) ? t('pagesDynamicSessionReports.m368', {"hhmmOf": hhmmOf(since)}) : ai(t('pagesAuditPunct.a56')))
    : running ? t('pagesFinalCopy.working') : t('pagesDynamicSessionReports.m369', {"hhmmOf": hhmmOf(since)});
  const stage = sessionStage(item, review);
  $('ss-stage').replaceChildren(...(stage ? [pill(stage.text, stage.tone, {dot: true})] : []));
  if (running) ticking(state, t('pagesAuditThird.a188'), item.startedAt); else { delete state.dataset.since; delete state.dataset.prefix; }
  // What to read: one line when the form is ready (Claude's words one click away), else Claude's own text.
  const said = intro.filter(line => line.replace(/\*/g, '') !== ask && !isDevTalk(line));
  $('ss-question').replaceChildren(...(submitted ? [el('p', 'rich-p', t('pagesDynamicSessionReports.m370', {"storeName": storeName()}))]
    : stuck ? [el('p', 'rich-p', item.stuck === 'account'
      ? t('pagesSessionHelp.accountHelp')
      : item.stuck === 'other' ? t('pagesSessionHelp.unknownApply')
      : item.stuck === 'site_broken' ? t('pagesDynamicSessionReports.m371', {"value1": item.accountNeeds || t('pagesSessionHelp.siteDidNotAnswer')})
      : item.stuck === 'told' ? t('pagesDynamicSessionReports.m372', {"value1": item.accountNeeds || ''})
      : item.stuck === 'email' ? t('pagesDynamicSessionReports.m373', {"value1": item.accountNeeds || t('pagesSessionHelp.addressOnPage')})
      : item.stuck === 'incomplete' ? t('pagesSessionHelp.nothingFilledHelp')
      : t('pagesSessionHelp.noFormHelp')),
      // The next press, in the AI's own words (e.g. 'Solve the check, then press "Créer un compte"'): what is left for you on this page.
      ...(['account', 'incomplete'].includes(item.stuck) && item.accountNeeds ? [el('p', 'rich-p', el('b', '', t('pagesAuditThird.a189')), item.accountNeeds)] : [])]
    : stopped ? [el('p', 'rich-p', stopHelp(item))]
    : gone && asking ? [el('p', 'rich-p', t('pagesSessionHelp.closedQuestion'))]
    : gone ? [el('p', 'rich-p', item.kind === 'form' ? t('pagesSessionHelp.closedFormHelp') : t('pagesSessionHelp.closedFilledHelp'))]
    : open ? [el('p', 'rich-p', t('pagesSessionHelp.completeRemaining')) ]
    : review ? [el('p', 'rich-p', item.kind === 'form' || item.inChrome ? t('pagesSessionHelp.extensionFillReview') : t('pagesSessionHelp.reviewLegal'))]
    : asking ? (forYou.length
      // Claude listed what it needs: its first sentence for context, then each thing as a line, then where to answer.
      // Why Claude stopped stays in sight here (owner, 12 Oct 2026: it was folded away); each thing it needs is a row of the card below, with its answer box.
      ? [...(said.length ? richText(said.join('\n')) : []), ...(isLive(item) ? [answerHint()] : [])]
      : [...(said.length ? richText(said.join('\n')) : [el('p', 'rich-p', ai(t('pagesAuditPunct.a57')))]), ...(isLive(item) ? [answerHint()] : [])])
    : [Object.assign(el('p', 'rich-p muted', (running && latestStep(sessionTail[item.id] || '')) || item.note || ''), {id: running ? 'ss-step' : ''})]));
  const full = $('ss-full');
  full.replaceChildren(...(review && item.question ? richText(item.question) : []));
  if (fullFor !== item.id) { full.hidden = true; fullFor = item.id; }
  // At the bottom of "What happened", folded: once the form is filled the cards say what to do; the report is there
  // for its exact words.
  const record = accountRecordLine(item);   // "Account created on X · terms accepted: '…' · code from your email" (session-state.js)
  if (record) $('ss-question').append(el('p', 'muted small', record));
  const toggle = $('ss-full-toggle');
  const label = () => { toggle.textContent = ai(full.hidden ? t('pagesAuditPunct.a58') : t('pagesAuditPunct.a59')); };
  show(toggle, !!(review && item.question));
  label();
  toggle.onclick = () => { full.hidden = !full.hidden; label(); };
  const actions = [], live = isLive(item);
  if (stuck) {
    // Tier 3: the cheap ways ran out. Chrome first, Claude the safety net (owner, 9 Oct 2026: "remove the 'Apply with Claude' from being orange";
    // the panel's "Take over with Claude" is there while the form tab is open, this one when it isn't).
    if (item.url) actions.push(sessionButton(t('pagesCommon.openChrome'), 'primary', async event => { await openForm(item, event.currentTarget); }, 'link'));
    const offer = INFORM_STUCK.includes(item.stuck) ? {buttons: [], notes: []} : offerParts(item, {rerender: () => renderNextStep(item), after: async result => { await refreshSessions(); if (result?.session?.id) openSession(result.session.id); }});   // claude-offer.js
    actions.push(...offer.buttons);
    if (offer.notes.length) $('ss-question').append(...offer.notes);
  }
  // Claude is the safety net, never the main action (owner, 9 Oct 2026: "remove Resume Claude from being orange"): always secondary; the way to the form is promoted below.
  const resume = () => sessionButton(t('pagesSession.resumeClaude'), 'secondary', () => resumeSession(item), 'refresh');
  const pushResume = () => { if (resumeOffered()) actions.push(resume()); };   // off for now: see resumeOffered in claude-help.js
  if (gone || stopped) {
    // Nothing to bring forward: the tab is gone. The app opens the job with the fill mark, the way "Fill in Chrome" does.
    actions.push(sessionButton(t('pagesSession.reopenForm'), 'primary', event => reopenClosedTab(item, event.currentTarget), 'link'));
  }
  if (review) {
    if (!gone) actions.push(sessionButton(t('pagesSession.openFilled'), 'primary', async event => {
      const result = await opening(event.currentTarget, () => window.pilot.showBrowser(item.url, sessionCompany(item), item.id));
      // The page's panel answered: nothing to repair. When it didn't, the repair appears right here, and the row is
      // redrawn so it is there before the next click.
      if (panelAnswered(result)) {
        if (panelDead.delete(item.id)) renderSessionPage();
        return;
      }
      if (result?.went === 'none') { await reopenClosedTab(item, event.currentTarget); return; }   // no tab to bring forward: open the form again
      panelDead.add(item.id);
      renderSessionPage();
      toastMessage(t('pagesSession.formTabMissing'), t('pagesAuditPunct.a60')
        + t('pagesAuditThird.a190'), sessionPlace(item), 'bad');
    }, 'link'));
    // A form page whose panel died (the extension was uninstalled and installed again) can't answer the app: reload
    // that tab, which is what puts the extension back onto it — then the focus handshake works again. Offered only
    // after a page has just failed to answer (panelDead), never as an everyday action: a reload loses whatever was
    // typed in the form since the last save (1 Oct 2026).
    if (panelDead.has(item.id) && !gone) actions.push(sessionButton(t('pagesSession.reloadTab'), 'secondary', async event => {
      const result = await opening(event.currentTarget, () => window.pilot.reviewReload(item.id, item.url, sessionCompany(item)));
      if (result?.result === 'reloaded' || result?.result === 'reloaded-chrome') {
        panelDead.delete(item.id);
        renderSessionPage();
        if (result.went !== 'tab') toastMessage(t('pagesSession.reloadedWaiting'), t('pagesSessionHelp.freshTabWait'), NO_PLACE.outside, 'warn');
        return;
      }
      if (result?.outdated) {
        toastMessage(t('pagesSession.reloadExtension'), t('pagesDynamicSessionReports.m374', {"extension": result.extension, "latest": result.latest}) +
          t('pagesSessionHelp.reloadExtensionHelp'), {card: 'extension'}, 'warn');
        return;
      }
      const why = {permission: t('pagesAuditPunct.a61'),
        // Chrome running with no windows means an automation's headless Chrome holds the scripting connection, not
        // the window the user is working in: say so, rather than "no tab matches" about a tab that is right there.
        'no-window': t('pagesAuditThird.a191'),
        'no-tab': t('pagesAuditThird.a192'),
        'no-chrome': t('pagesAuditThird.a193'),
        // Chrome's scripting is macOS-only. Saying "Chrome isn't running" on Windows would be untrue, and the
        // generic advice names ⌘R, which isn't a key there.
        manual: t('pagesAuditThird.a194')}[result?.result];
      toastMessage(t('pagesSession.reloadFailed'), why || t('pagesAuditThird.a195'), sessionPlace(item), 'bad');
    }, 'refresh'));
    if (item.kind !== 'form') actions.push(submittedButton(item));  // you pressed Submit in Chrome: say so here too (a form session's submit is seen by the extension)
    if (live) actions.push(sessionButton(t('pagesCommon.skipRole'), 'secondary', () => skipSession(item)));
    else if (item.resumable) pushResume();
    const yours = el('span', 'ss-submit-yours muted small');
    yours.append(icon('info'), el('span', '', t('pagesSession.submitIsYours')));
    actions.push(yours);
  } else if (asking && !live) {
    if (item.resumable) pushResume();
    // Claude closed with the app, but the form may still be open in Chrome.
    if (item.url && !gone) actions.push(sessionButton(t('pagesCommon.openChrome'), 'secondary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(submittedButton(item));
    actions.push(sessionButton(t('pagesSession.removeList'), 'secondary', () => removeSession(item)));
  } else if (asking) {
    // Continue only means something after a pause (Esc). When Claude asked for something, "Continue." gives it nothing
    // new and it asks again (a 4-hour loop on 1 Oct 2026): the main action is to answer it.
    if (/^Paused/i.test(item.note || '')) {
      actions.push(sessionButton(t('pagesCommon.continue'), 'primary', () => say('Continue.')));
      actions.push(sessionButton(t('pagesSession.ownWords'), 'link', () => openLog(true), 'chat'));
    } else {
      actions.push(sessionButton(t('pagesCommon.answer'), 'primary', () => openLog(true), 'chat'));
    }
    // The form is waiting in Chrome while Claude asks: one click to look at it, as when it works.
    if (item.url) actions.push(sessionButton(t('pagesCommon.openChrome'), 'secondary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(submittedButton(item));
    actions.push(sessionButton(t('pagesCommon.skipRole'), 'secondary', () => skipSession(item)));
  } else if (running) {
    if (item.url) actions.push(sessionButton(t('pagesCommon.openChrome'), 'primary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(sessionButton(t('pagesSession.pause'), 'secondary', pauseSession));
    actions.push(submittedButton(item));
    actions.push(sessionButton(t('pagesSession.watchLog'), 'link', () => openLog(true), 'eye'));
  } else if (item.resumable && !submitted) {
    pushResume();
    actions.push(submittedButton(item));
  }
  // Every state with a job keeps a way to its form (owner, 8 Oct 2026: an ended session showed only Resume Claude).
  const toForm = /^(Open in Chrome|Reopen form|Open filled form)$/;
  if (item.url && !submitted && !actions.some(button => toForm.test(button.textContent))) {
    actions.splice(1, 0, sessionButton(t('pagesCommon.openChrome'), actions.length ? 'secondary' : 'primary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
  }
  // One main action: with none, the way to the form is it, first in the row (a Claude button is never the orange one).
  if (!actions.some(button => button.classList.contains('primary'))) {
    const toIt = actions.find(button => toForm.test(button.textContent));
    if (toIt) { toIt.classList.replace('secondary', 'primary'); actions.splice(actions.indexOf(toIt), 1); actions.unshift(toIt); }
  }
  drawActions($('ss-actions'), actions);
  renderCards(item, {checks, forYou, audit, done, review, asking, gone});
}

// The cards under the step: what Claude needs from you (answer, agree, confirm), then what happened (moved out of renderNextStep, 28 Oct 2026, for the live card).
function renderCards(item, {checks, forYou, audit, done, review, asking, gone}) {
  // Two sections under the step: what Claude needs from you (answer, agree, confirm), then what happened
  // (what it filled, the problems it hit, its audit). Its other report sections join what happened.
  const sorted = sortChecks(checks), mine = sortChecks(forYou, {forYou: true});
  const needs = [...mine.needs, ...sorted.needs], filled = sorted.filled;
  const empty = gone ? [] : emptyFields(item, needs);   // a closed tab has no empty fields to open
  show($('ss-needs-card'), needs.length + empty.length > 0 && !gone);   // a closed tab's rows are stale: Reopen form asks what to keep
  $('ss-needs-title').textContent = t('pagesSession.needsAttention');
  $('ss-needs-sub').textContent = review ? t('pagesSession.checkBeforeSubmit') : asking ? ai(t('pagesAuditPunct.a62')) : t('pagesSession.completeItems');
  $('ss-needs').replaceChildren(...needs.map(need => (need.kind === 'ask' ? askRow(need, item) : needRow(need, item))), ...empty.map(label => emptyRow(label, item)));
  watchAgreements(item, needs.filter(need => need.kind === 'agree' || need.kind === 'ask'));
  applyFormStates(item);
  showFormState(item);
  updateNeedsCount();
  showOptional(item, {gone, listed: empty});   // the optional ones, folded below (session-optional.js)
  showSendBar(item);   // answers not sent yet stay with their send button when the page redraws
  // The live field list ("In the form") says what was filled, field by field: Claude's "Filled:" summary only without it.
  const listed = !!reviewStates.get(item.id)?.filled?.length;
  const happened = [
    ...done.filter(section => !(listed && /^filled$/i.test(section.label || ''))).map(section => {
      // "**Filled:**" with its details on the bullets under it: the line shows the first of them (+ how many more);
      // the list is one click away.
      const extra = !section.text && section.items.length > 1 ? t('pagesShortSettings.m321', {"value1": section.items.length - 1}) : '';
      const lead = firstLine(section.text || section.items[0] || '') + extra;
      return {short: section.label ? `**${section.label}:** ${lead}`.trim() : lead, problem: section.label === 'Problems' || PROBLEM.test(section.text),
        more: section.text ? [section.text.slice(firstLine(section.text).length).trim(), ...section.items.map(line => `- ${line}`)].filter(Boolean).join('\n')
          : section.items.length > 1 ? section.items.map(line => `- ${line}`).join('\n') : ''};
    }),
    ...filled.map(({text, problem}) => {
      const {label, text: rest} = splitLabel(text);
      const short = label || firstLine(rest);
      return {short, problem, more: label ? rest : rest.slice(short.length).trim()};
    })];
  // Problems first: they explain the rest.
  happened.sort((x, y) => Number(y.problem) - Number(x.problem));
  $('ss-happened').replaceChildren(...happened.map(({short, more, problem}) => {
    const row = foldRow(short, more);
    // A problem Claude worked around, on a form that's now ready: history, not a warning.
    if (problem) row.classList.add(formReady(item) ? 'is-solved' : 'is-problem');
    if (problem && /extension/i.test(`${short} ${more}`)) explainExtension(row);
    return row;
  }));
  show($('ss-audit-card'), !!audit);
  $('ss-audit-pill').replaceChildren();
  if (audit) {
    const capital = audit.charAt(0).toUpperCase() + audit.slice(1);
    const summary = firstLine(capital, 160), rest = capital.slice(summary.length).trim();
    const fixes = (audit.match(/\b(?:corrected|removed|fixed|by hand)\b/gi) || []).length;
    $('ss-audit-pill').replaceChildren(...(fixes ? [pill(t('pagesShortSettings.m322', {"fixes": fixes, count: fixes}), 'warn', {dot: true})] : [pill(t('pagesSession.checked'), 'good', {dot: true})]));
    $('ss-audit-summary').replaceChildren(...richText(summary).flatMap(node => [...node.childNodes]));
    $('ss-audit-detail').replaceChildren(...richText(rest));
    show($('ss-audit-more'), !!rest);
  }
  show($('ss-happened-card'), happened.length > 0 || !!audit || !!(review && item.question));
  // Claude's report, from when it finished: folded (the cards above are today's state), open while a problem it hit
  // still stands (the form isn't ready).
  $('ss-happened-when').textContent = `· ${hhmmOf(item.needsYouSince || item.endedAt || item.startedAt)}`;
  if (reportFor !== item.id) {
    reportFor = item.id;
    $('ss-happened-card').classList.toggle('is-open', happened.some(entry => entry.problem) && !formReady(item));
  }
  initOptional();
  $('ss-happened-head').onclick = event => { if (!event.target.closest('a, button')) $('ss-happened-card').classList.toggle('is-open'); };
}
