// Recent activity: run names, phases, outcomes, the Gmail connection and the card chooser (cardFor).
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {counted as countedLabel} from './page-counts.js';
import {date as displayDate} from '../../i18n/format.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {billingLabel} from '../ai-engine-view.js';
import {costText, dollars} from '../ai-cost.js';
import {resumeOffered} from '../claude-help.js';
import {AI_BUSY, groupWarnings, humanError, limitedJobs, plainError, sentences} from '../run-warnings.js';
import {aiLimitHead, failedOutcome, stoppedHead, deliveryHead, notConnectedHead, waitedHead, unsavedRun} from '../run-status.js';
import {el} from '../components.js';
import {parseRunMessage} from '../run-cards.js';
import {parseVisits} from '../visits-card.js';
import {mailCardShown, parseMailReport} from '../mail-report.js';
import {parseInsight} from '../insight-card.js';
import {parseWeekly} from '../weekly-card.js';
import {parseInterviewReview} from '../interview-review.js';
import {parseKitsReady} from '../kits-ready.js';
import {openSetting} from './settings.js';
import {$} from './core.js';
import {lastAnswered, pendingMailQuestions} from './focus.js';
import {keepPress, setPress, pressWhile, claudeReadButton, renderVisitsCard, viewJobsButton} from './activity-visits.js';
import {lastActivity, renderActivity} from './activity-render.js';
import {renderRunCard} from './activity-run-card.js';
import {renderMailCard} from './activity-mail.js';
import {renderInsightCard, renderInterviewCard, renderKitsCard, renderWeeklyCard} from './activity-cards.js';
import {storeName} from '../store-words.js';
import {WORDS} from '../run-result-card.js';
import {runCommand} from './actions.js';
import {MACHINE_LINE} from '../run-lines.js';

// ---------- runs ----------
export const clockTime = iso => displayDate(new Date(iso), {weekday: 'short', hour: '2-digit', minute: '2-digit'});
/** Format two valid run timestamps as a localized minute/second duration. */
export const duration = (a, b) => { const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000); return s >= 60 ? t('pagesShortActivity.m4', {"value1": Math.floor(s / 60), "value2": s % 60}) : `${s} s`; };
// The line under "Jobs": what's happening now, or when the last search ran.
export async function showSearchStatus() {
  const {running, lastSearchAt, runs} = await window.pilot.runs();
  const box = $('search-status');
  const [title, detail] = [box.querySelector('b'), box.querySelector('small')];
  const searching = running && (running.kind || 'search') === 'search';
  box.dataset.state = searching ? 'busy' : lastSearchAt ? 'ok' : 'none';
  // Running: a link to its progress (the bottom bar's panel); done: what it found.
  if (searching) { title.textContent = t('pagesActivity.findingJobs'); detail.textContent = searchPhase(running.step) || t('pagesCommon.starting'); return; }
  if (!lastSearchAt) { title.textContent = t('pagesActivity.noCheck'); detail.textContent = ''; return; }
  const last = runs.find(run => (run.kind || 'search') === 'search');
  const found = last?.new != null ? t('pagesDynamicActivity.m3', {"new": last.new, count: last.new}) : '';
  const cost = billingLabel(last || {}) ? ` · ${billingLabel(last)}` : costText(last?.usd, usd => ` · ${dollars(usd)}`);
  if (last && !last.ok) { title.textContent = t('pagesActivity.checkProblems'); detail.textContent = clockTime(lastSearchAt); return; }
  title.textContent = t('pagesShortActivity.m5', {"when": clockTime(lastSearchAt), "found": found, "cost": cost});
  detail.textContent = '';
}

// ---------- activity bar (bottom of every screen) ----------
// Plain-language phases of a search, recognised from its log lines.
export const PHASES = [
  {match: /^(Searching job boards|Job boards:)/, label: t('pagesActivity.jobBoards')},
  {match: /^Checking employer career pages/, label: t('pagesActivity.careerPages')},
];
// A running task's step as words, wherever it is shown (Actions banner and summary, header, bottom bar): a known phrase, else the engine's line
// without its technical tail (7 Oct 2026: "Scored 60 of 60 job(s) with claude-sonnet-5-5; 0 failed; tokens in 120 (+173594 cached), out 22743").
export function stepWords(step = '') {
  if (MACHINE_LINE.test(step)) return '';   // Why (#3923, 12 Nov 2026): never the engine's number lines raw; the caller says "starting" or keeps its last step
  return searchPhase(step) || String(step).split(';')[0].replace(/\s+with claude-[\w.-]+/g, '').replace(/\s*\(\+?[\d,]+ cached\)/g, '').trim();
}
// A "⏳ <step>: N of M …" counter line as its words, or '' (the app's own "⏳ Still running" heartbeat is not a counter).
export const liveCount = (line = '') => (/^⏳\s*(?!Still running)(.+: \d[\d,]* of \d[\d,]*.*)$/.exec(line) || [])[1] || '';
// A search's current log line as a short phrase for the header and the bottom bar (the raw line is in the log).
export function searchPhase(step = '') {
  if (MACHINE_LINE.test(step)) return '';
  const live = liveCount(step);   // the engine's own counter (src/progress.py): "Reading employer job sites: 120 of 202 · 3,412 jobs listed"
  if (live) return live;
  const phase = PHASES.find(item => item.match.test(step));
  if (phase) return phase.label;
  if (/^Scored (\d+) of (\d+)/.test(step)) return t('pagesExtraCommon.matching');
  if (/^Enriched (\d+) of (\d+)/.test(step)) return t('pagesExtraCommon.readingNew');
  if (/^Checked: /.test(step)) return t('pagesActivity.careerPages');
  if (/^Job Matches:/.test(step)) return t('pagesDynamicActivity.m4', {"storeName": storeName()});
  if (/digest|telegram/i.test(step)) return t('pagesExtraCommon.sendingDigest');
  return step.length > 60 ? `${step.slice(0, 57)}…` : step;
}
// icon: emoji for text the owner reads (toasts, messages); line: the line icon for rows and headers (same as Actions → Recent runs).
export const KIND = {search: {icon: '🔎', line: 'search', name: t('pagesCommon.findJobs')}, mail: {icon: '📧', line: 'mail', name: t('pagesActivity.gmailCheck')}, insight: {icon: '💡', line: 'chart', name: t('pagesActivity.insight')},
  interviewInsight: {icon: '💡', line: 'bulb', name: t('pagesActivity.interviewInsights')}, tailor: {icon: '✂️', line: 'scissors', name: t('pagesActivity.tailor')}, visits: {icon: '🌐', line: 'globe', name: t('pagesActivity.browserFind')},
  weekly: {icon: '📊', line: 'file', name: t('pagesActivity.searchAnalysis')}, kits: {icon: '📝', line: 'file-text', name: t('pagesActivity.prepareTop')}, today: {icon: '📋', line: 'send', name: t('pagesActivity.todayList')}, scout: {icon: '🔭', line: 'building', name: t('pagesActivity.moreEmployers')},
  action: {icon: '⚡', line: 'zap', name: t('pagesActivity.telegramAction')}, prepare: {icon: '📝', line: 'file-text', name: t('pagesActivity.preparation')}, interview: {icon: '🎤', line: 'mic', name: t('pagesActivity.interviewReview')},
  add: {icon: '📥', line: 'inbox', name: t('pagesActivity.logged')}, import: {icon: '➕', line: 'search', name: t('pagesActivity.addJob')}, rejection: {icon: '🔍', line: 'search', name: t('pagesActivity.rejectionReview')},
  prep: {icon: '🎤', line: 'mic', name: t('pagesActivity.prepKit')}};
export const KITS_CARD = new Set(['kits', 'prepare', 'tailor']);   // the runs whose result is a list of jobs on the kits card
export const kindOf = run => (KIND[run?.kind] ? run.kind : 'search');
export const WHO = {schedule: t('pagesFinalCopy.scheduled'), you: t('pagesExtraCommon.byYou'), first: t('pagesExtraCommon.firstCheck')};
export const WHERE = {github: 'GitHub', mac: t('pagesFinalCopy.thisMac'), cloud: t('pagesExtraCommon.ourServers')};  // where a run ran, after who started it
// The warnings in one plain sentence (the list is one click away).
export function warningSummary(warnings) {
  // The Anthropic account's spending limit: jobs were left unscored. Said plainly, with what to do.
  const limited = limitedJobs(warnings);
  if (limited && warnings.some(text => /Claude Code/.test(text))) {  // the user's own Claude Code: its plan's usage window
    return t('pagesDynamicActivity.m5', {"plural": plural(limited, 'job'), count: limited})
      + t('pagesAuditFirst.a4');
  }
  if (limited) {
    return t('pagesDynamicActivity.m6', {"plural": plural(limited, 'job'), count: limited})
      + t('pagesAuditFirst.a5');
  }
  // The same limit stopped a step that scores nothing (a Gmail check's own AI call, an insight): say that, not the
  // API's error dump.
  if (warnings.some(text => /usage limits?|credit balance|AI limit reached|spending limit/i.test(text))) {
    return t('pagesAuditFirst.a6')
      + t('pagesAuditFirst.a7');
  }
  if (warnings.some(text => AI_BUSY.test(text))) {
    return t('pagesAuditFirst.a8');
  }
  if (warnings.some(text => /429|Too Many Requests/i.test(text))) {
    return t('pagesAuditFirst.a9');   // about Notion
  }
  // Otherwise the warnings in plain words (run-warnings.js groupWarnings): one or two said here, more under "View N details".
  const plain = groupWarnings(warnings);
  if (plain.length) return sentences(plain, plain.length > 2);
  return humanError(warnings[0]) || '';
}
// "<task> completed with warnings": which run it is, said in the box's title.
export const WARN_NOUN = {search: t('pagesExtraCommon.jobSearch'), scout: t('pagesExtraCommon.employerSearch'), mail: t('pagesActivity.gmailCheck'), tailor: t('pagesExtraCommon.tailoring'), visits: t('pagesExtraCommon.siteReading'), kits: t('pagesActivity.preparation'),
  weekly: t('pagesActivity.searchAnalysis'), insight: t('pagesExtraCommon.theInsight'), today: t('pagesExtraCommon.todayList')};
export const runResults = new Map();  // run id -> the message a finished task produced, for Recent activity
export const runDetails = new Map();  // a Notion run's result and log, read once (pageId -> {message, log})
// Find jobs using your browser' step card (renderer/visits-card.js parseSiteRows): the meter (the few-jobs box's score-track) and one row per site.
const SITE_MARK = {next: 'todo', opening: 'now', waiting: 'warn', reading: 'now', done: 'done', stopped: 'fail', closed: 'fail'};
// How far a running task is, over the shared meter: Find jobs using your browser ("N of M sites"), and any task whose live step counts (owner, 7 Oct 2026: "a live
// progress bar above the Technical log"): Find new employers' "checked 33 of 91", a search's "Reading employer job sites: 120 of 202".
export function runProgress({done, total, percent}, noun = '') {
  const li = el('li', 'run-progress');
  const track = el('span', 'score-track'), fill = el('span', 'score-fill');
  fill.style.width = `${percent}%`;
  track.append(fill);
  li.append(el('span', '', t('pagesShortActivity.m6', {"done": done, "total": total, "value3": noun ? ` ${noun}` : '', "percent": percent})), track);
  return li;
}
// The one thing to do on a row, as a link after its words (as "Explain with AI"): a wait on you, a tab to look at, a tab you closed, a silent extension.
// Each row's one action, a button on its right (owner, 7 Oct 2026: "per row, on the right, Open in Chrome"): the tab while it reads, the site
// once it is done, Allow while it waits on you, Open again for a tab you closed, the extension when it did not answer.
function siteAction(site) {
  if (site.state === 'waiting') return [t('pagesFocusReports.goAllow'), () => window.pilot.focusBrowser()];
  if (site.state === 'reading' || site.state === 'opening') return [t('pagesCommon.openChrome'), () => window.pilot.visitShowTab(site.url)];
  if (site.state === 'closed') return [t('pagesExtraCommon.openAgain'), () => window.pilot.visitAgain(site.url)];
  if (site.state === 'stopped' && /no answer from the extension|did not answer/.test(site.words)) return [t('pagesExtraCommon.checkExtension'), () => openSetting('extension')];
  if (site.state === 'next') return null;   // not opened yet: no tab to show
  return [t('pagesCommon.openChrome'), () => window.pilot.openVisit(site.url)];   // done or stopped: the site itself
}
// live: the run is going. A finished run keeps its rows and marks (owner, 7 Oct 2026: "keep the ticks and crosses after the task completes"),
// without the links that act on a running tab; a site the run left mid-way reads as stopped there, not as still going.
const settled = site => (['done', 'stopped', 'closed'].includes(site.state) ? site : {...site, state: 'stopped', words: t('pagesDynamicActivity.m7', {"value1": site.words.replace(/…$/, '')})});
export function siteRow(site, live = true, since = '') {
  if (!live) site = settled(site);
  const li = el('li', `${SITE_MARK[site.state] || 'todo'} site-row`);
  const words = el('div', 'site-words', site.name);
  words.append(el('span', 'phase-note', capital(site.words)));
  li.append(words);
  const viewJobs = site.state === 'done' && viewJobsButton(site, site.words, since);   // more than one new job: Jobs filtered to them
  if (viewJobs) li.append(viewJobs);
  // A finished run keeps only what still makes sense: the site itself, or the extension check (not a running tab's actions).
  // A finished run's stopped site: Read with Claude beside Open in Chrome (= Open it myself), as the result card's row had them.
  const finishedMiss = !live && ['stopped', 'closed'].includes(site.state);
  if (finishedMiss && site.url && resumeOffered() && !/no answer from the extension|did not answer/.test(site.words)) li.append(claudeReadButton(site, words));   // only with Claude help on (claude-help.js)
  const action = site.url && (finishedMiss && site.state === 'closed' ? [t('pagesCommon.openChrome'), () => window.pilot.openVisit(site.url)] : siteAction(site));
  if (action && (live || ['done', 'stopped', 'closed'].includes(site.state))) {
    const key = `site:${site.url}:${action[0]}`;
    const button = keepPress(key, Object.assign(el('button', 'secondary item-action', action[0]), {type: 'button', title: site.url}));
    button.addEventListener('click', async () => {
      const done = await pressWhile(key, '', async () => action[1]()).catch(error => ({ok: false, error: error.message}));
      if (done?.ok === false) setPress(key, {text: plainError(done.error || t('pagesActivity.couldNotNow'))});
    });
    li.append(button);
  }
  return li;
}
// A phase's label, with the sources the engine said it used ("Job boards: jobs.ch, …") instead of a fixed list.
export function phaseLabel(phase, lines) {
  const named = phase.match.test('Job boards:') && lines.map(line => /^Job boards: (.+)/.exec(line)).filter(Boolean).pop();
  // The boards by name, without the engine's own notes after them ("(Swiss place word: <a regex>)").
  return named ? `${phase.label} (${named[1].replace(/\s*\([^()]*:.*$/, '').trim()})` : phase.label;
}
export function phaseIndex(lines) {
  let index = -1;
  lines.forEach(line => PHASES.forEach((phase, i) => { if (phase.match.test(line)) index = i; }));
  return index;
}
/** Format a run timestamp with the active locale for compact activity times. */
export const hhmm = ms => displayDate(new Date(ms), {hour: '2-digit', minute: '2-digit'});
/**
 * When the next scheduled check is, in words, for any place that says it (the footer, Upcoming checks, Status): "due now" once the time has passed, else
 * "Today 14:00", "Tomorrow 01:53" or "Wed 01:53". Why (fx, 3 Nov 2026, a Windows tester): the footer printed "Next refresh 01:53 AM" at 02:00 and read as a refresh that never ran;
 * the app checks its schedule every 10 minutes, so a time up to ~10 minutes in the past is normal and must say so.
 * @param {number} at ms of the next check. @param {number} [now] ms. @returns {string}
 */
export function nextWords(at, now = Date.now()) {
  if (at <= now) return t('pagesExtraCommon.dueNow');
  const date = new Date(at), today = new Date(now), tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const day = date.toDateString() === today.toDateString() ? t('pagesCommon.today') : date.toDateString() === tomorrow.toDateString() ? t('pagesExtraCommon.tomorrow') : displayDate(date, {weekday: 'short'});
  return `${day} ${hhmm(at)}`;
}
/** Format a page-owned noun count with native plural categories; noun identifiers stay unchanged. */
export const plural = (n, word) => countedLabel(word, n);
export const capital = text => String(text || '').replace(/^./, c => c.toUpperCase());
// One line on what a finished run did.
export function outcome(run) {
  const said = outcomeOf(run);
  return deliveryHead({...run, kind: kindOf(run)}) ? t('pagesDynamicActivity.m8', {"capital": capital(said)}) : said;
}
function outcomeOf(run) {
  if (run.stopped === 'you') return t('pagesExtraCommon.stoppedByYou');
  // Closed while it ran (lib/pipeline.js INTERRUPTED): said as such, as its box does (7 Oct 2026: the row read "Unexpected error")
  if (run.interrupted) return t('pagesExtraCommon.interrupted');
  const explained = notConnectedHead(run) || waitedHead({...run, kind: kindOf(run)});
  if (explained) return explained.short;   // the box says the rest
  const stopped = stoppedHead({...run, kind: kindOf(run)});
  if (stopped) return t('pagesShortActivity.m9', {"stopped": stopped.stopped});   // the watchdog stopped it: the box says why and where
  if (run.problem && (kindOf(run) === 'mail' || !run.ok)) return run.problem;   // why it read nothing or did not arrive comes before the counts a Notion row says (#290, #298)
  if (aiLimitHead({...run, kind: kindOf(run)})) return t('pagesExtraCommon.resultsUnavailable');   // the AI provider stopped it: the box says why
  const failed = failedOutcome(run);
  if (failed) return failed;   // a failed run says so before what its Notion row reports (#301)
  if (!run.ok && !run.problem && !run.live && !run.waiting) return t('pagesExtraCommon.unexpectedError');   // no reason recognised: the box says what to do
  if (run.result) return run.result;  // a run read from Notion ⏱️ Search runs says it itself
  if (unsavedRun(run)) return t('pagesExtraCommon.resultNotSaved');   // the pill says No result (run-status.js)
  if (kindOf(run) === 'mail') {
    if (run.off) return t('pagesExtraCommon.gmailNotConnected');
    if (run.problem) return run.problem;
    if (!run.ok) return t('pagesExtraCommon.hadProblems');
    if (run.updates?.length) return plural(run.updates.length, 'application update');
    // "Mail: 2 new email(s) classified, 0 update(s), …": emails were read but none changed an application.
    const read = Number(/^Mail: (\d+) new email/.exec(run.summary || '')?.[1] || 0);
    return read ? t('pagesDynamicActivity.m9', {"plural": plural(read, 'email')}) : t('pagesExtraCommon.nothingNew');
  }
  if (!run.ok) return t('pagesExtraCommon.hadProblems');
  // A one-off job (insight, weekly report, today's list, find employers): the result line it printed.
  // An employers search or today's list says its number from its message (run-result-card.js WORDS), as its result card's top does: never "done".
  const card = !run.summary && WORDS[kindOf(run)] && run.message ? parseRunMessage(run.message) : null;
  if (kindOf(run) !== 'search') return run.summary || (card ? WORDS[kindOf(run)](card) : 'done');
  return run.new != null ? plural(run.new, 'new job') : t('pagesCommon.done');
}
// An Actions page command waits for its run (by kind) to end, then its answer shows the result.
// A Google sign-in that failed during a run, with Gmail working now: the run stays as it was, without the obsolete button.
export const GOOGLE_SIGNIN = /Google sign-in/i;
export const signedInSince = head => (head && GOOGLE_SIGNIN.test(head.problem || '') && gmailConnected() === true
  ? {...head, title: t('pagesActivity.googleFailed'), summary: t('pagesAuditFirst.a10'), hint: '', fix: null} : head);
// Whether Gmail is connected now (true / false / null = not known yet): Settings keeps the last check (localStorage
// 'serviceChecks'); it is read again from the app when Recent activity opens. A run's own state is history, not this.
let gmailNow = null;
export const gmailConnected = () => {
  if (gmailNow !== null) return gmailNow;
  try { return JSON.parse(localStorage.getItem('serviceChecks') || 'null')?.google?.connected ?? null; } catch { return null; }
};
export async function refreshGmailConnection() {
  const was = gmailConnected();
  gmailNow = await window.pilot.googleStatus().then(google => !!google?.connected).catch(() => null);
  if (gmailNow !== was && lastActivity) renderActivity(lastActivity);
}
// A task whose Actions card left for Focus and ⌘K (Analyze my job search, 28 Oct 2026) still runs again from Recent activity: its command, pressed in code.
const CARDLESS = new Set(['weekly']);
// A kind's Run button on the Actions page (its data-command), a stand-in that runs a card-less task's command, or nothing for a kind without one.
export const runButton = kind => {
  if (kind === 'tailor') return document.getElementById('tailor-top');   // no Telegram command: its own button
  if (kind === 'visits') return document.getElementById('visits-run');
  const command = Object.keys(COMMAND_KIND).find(key => COMMAND_KIND[key] === kind);
  if (command && CARDLESS.has(command)) return {click: () => runCommand(command)};
  return command ? document.querySelector(`button.action[data-command="${command}"]`) : null;
};
export const COMMAND_KIND = {insight: 'insight', weekly: 'weekly', today: 'today', kits: 'kits', mail: 'mail', run: 'search'};
// Buttons outside the Actions cards that start the same task (Jobs → Refresh jobs, Settings → Check Gmail now, Tailor's own card): turned off while
// it runs (runs-page.js syncRunButtons) and left out of ⌘K when an Actions card already offers it (nav.js paletteCommands), so a task is listed once.
export const TASK_BUTTONS = [['search', '#refresh'], ['mail', '#check-mail'], ['tailor', '#tailor-top', '#tailor-top-n'], ['visits', '#visits-run', '#visits-at-once', '#board-run']];
// The Actions page's result card: a finished task's header (what, how it ended, when) over the Recent activity card.
// The card a finished run's message makes, as a function that draws it into a card box, or null when the message has no card shape (then it is shown as text).
// One place for both views: the Actions page and Recent activity must never show the same run as a card in one and as Telegram text in the other (5 Oct 2026:
// "Search analysis" was raw text on the Actions page, with its emoji lines and a bare Notion address).
// A Gmail check's card, wherever the run came from: a Notion row (its report lines and result) or a run this Mac kept
// (its `updates` from the log and a "Mail: …" summary). Always on and on-the-Mac runs read the same card (6 Oct 2026: a
// Mac run's "💬 Reply received · …" was a bare bullet, and "1 new email read, 0 updates" had no card at all).
export function mailReportOf(run, message = run?.message) {
  if (!run || kindOf(run) !== 'mail' || !mailCardShown(run)) return null;
  const rows = run.report?.length ? run.report : run.updates?.length ? ['', ...run.updates] : [];
  return parseMailReport(message || '', run.result || run.summary || '', rows);
}
export function cardFor(run, text) {
  const card = text ? parseRunMessage(text) : null;
  if (card) return target => renderRunCard(card, run, target);
  const mail = mailReportOf(run, text === run?.result ? '' : text);
  if (mail) return target => renderMailCard(mail, pendingMailQuestions(), lastAnswered(), target);
  if (!text) return null;
  const insight = parseInsight(text);
  if (insight) return target => renderInsightCard(insight, target);
  const weekly = parseWeekly(text);
  if (weekly) return target => renderWeeklyCard(weekly, target);
  const review = kindOf(run) === 'interview' ? parseInterviewReview(text) : null;
  if (review) return target => renderInterviewCard(review, target);
  const kits = KITS_CARD.has(kindOf(run)) ? parseKitsReady(text) : null;
  if (kits) return target => renderKitsCard(kits, target);
  const sites = parseVisits(text);
  if (sites) return target => renderVisitsCard({...sites, since: run?.startedAt}, target);
  return null;
}

