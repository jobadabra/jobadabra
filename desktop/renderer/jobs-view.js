// The Jobs page's derived bits, kept free of the DOM so the tests can check them.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {columnOf, stageText} from './jobs-board-rules.js';
import {isInbound} from './origin.js';
import {foldToggleWord} from './fold-toggle.js';
import {READY_LABEL} from './pages/ready-rows.js';

// Skills, tools, licences or topics under a role: what the AI read from the posting (src/ai/enrich.py `technologies`, in the posting's language), for any trade.
export function tags(job, max = 4) {
  const skills = (Array.isArray(job.skills) ? job.skills : []).map(skill => String(skill).trim()).filter(Boolean);
  return [...new Set(skills)].slice(0, max);
}

const WEEK = 7 * 24 * 3600 * 1000;
// The four counters above the list.
export function stats(jobs, total, now = Date.now()) {
  return {
    total: total ?? jobs.length,
    high: jobs.filter(job => job.fit >= 70).length,
    week: jobs.filter(job => now - Date.parse(job.first_seen_at) <= WEEK).length,
    companies: new Set(jobs.map(job => (job.company || '').trim().toLowerCase()).filter(Boolean)).size,
  };
}

// Every job count on the Jobs page (the counters, the menu badge's siblings, the Find jobs card) comes from here, so two numbers for the same
// thing cannot appear (18 Oct 2026: a search said "206 Listed" over "351 Total matches"). `data` is what desktop_jobs.jobs() returns: the loaded
// rows (a cut list: 200 + every application) and the whole-store figures. Matches = job matches (no applications, no inbound), loaded or not.
export function jobCounts(data, now = Date.now()) {
  const loaded = data?.jobs || [], matched = openMatches(loaded);
  const beyond = data?.total == null ? 0 : Math.max(0, data.total - loaded.length);   // matches the cut list did not load
  const count = stats(matched, matched.length + beyond, now);
  count.week += data?.week_beyond || 0;
  count.high += data?.high_beyond || 0;
  // anyJob: any row at all, applications and inbound too. A yes or no, never a count: the list may be cut.
  return {...count, anyJob: loaded.length > 0, scored: matched.filter(job => job.fit != null).length + (data?.scored_beyond || 0)};
}

/**
 * What the list bar says when New matches is the whole list: {new, total} for "12 new of 13 matches", or null when the plain count already says it.
 * Why (#3377, owner 7 Nov 2026: "Words say it"): the header's Total matches counts saved and dismissed matches too (jobCounts), the list opens on the unreviewed ones only, so
 * "13 matches" over "12 jobs" read as a mistake; the numbers stay, the words name each set. Only on the plain New matches list (no counter, no search words).
 * @param {{filter: string, statFilter: *, text: string, shown: number, data: object}} view the sole ticked filter, the counter clicked, the search words, the rows drawn, the jobs the engine sent
 * @returns {{new: number, total: number}|null}
 */
export function newOfTotal({filter, statFilter, text, shown, data}) {
  if (filter !== 'open' || statFilter || text || !data) return null;
  if (data.total != null && data.total > (data.jobs || []).length) return null;   // a cut list (the engine sends the best rows): the rows left out may be new too, so no split
  const {total} = jobCounts(data);
  return total > shown ? {new: shown, total} : null;   // equal: the plain count says it; fewer (a list not yet reloaded): never "12 new of 11"
}

// Applications right now, by their Notion Stage, with the same stage sets as the Focus funnel (src/notion/funnel.py):
// sent = an outcome stage (not "Applying", a form still being filled); ended = rejected, withdrawn, no answer;
// in process = screening (Screening, Interview scheduled: often a screening call) or interviews (Interviewing, Offer).
// The funnel counts what each application ever reached; these count where it stands now.
export const SENT = new Set(['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer',
  'Rejected', 'Withdrawn', 'No response']);
export const ENDED = new Set(['Rejected', 'Withdrawn', 'No response']);
export const SCREENING = new Set(['Screening', 'Interview scheduled']);
export const INTERVIEWS = new Set(['Interviewing', 'Offer']);
const TALKING = new Set([...SCREENING, ...INTERVIEWS]);
// Sent = waiting + in process + closed: the boxes add up, except for opportunities that found you (inbound,
// renderer/origin.js): they count in Waiting / In process / Closed (real workload) but as Applied only once you applied
// (an Applied on date), not because a recruiter's pitch reached Screening.
const WAITING = new Set(['Applied', 'Confirmation received']);
// Why (df 2/2, 13 Nov 2026, owner: "Sent only (Recommended)"): Applied is ONE rule, applications really sent, for the Applied card AND the Show menu's Applied (jobs-filters.js). The card used to count
// the sent stage while the menu counted status "applied", so a job marked applied with no sent stage (a form still being filled, Applying) showed 3 in the menu and 0 on the card. Stages are read
// through columnOf like the board and the views: a job marked Applied only on its match row (no stage) is Applied. Forms still being filled stay under the menu's Applying.
export const isSent = job => SENT.has(columnOf(job)) && (!isInbound(job) || !!job.applied_on);
const APPLICATION = {
  waiting: job => WAITING.has(columnOf(job)),
  interviews: job => TALKING.has(columnOf(job)),
  closed: job => ENDED.has(columnOf(job)),  // rejected, withdrawn, or no answer
};
/** The Applied card's second part: of the applications sent, how many wait for a reply and how many are closed. */
export const sentBreakdown = jobs => { const sent = jobs.filter(isSent); return {waiting: sent.filter(APPLICATION.waiting).length, closed: sent.filter(APPLICATION.closed).length}; };
// The "In process" box's hover: how many are screening and how many interviewing.
export const inProcess = jobs => ({screening: jobs.filter(job => SCREENING.has(job.stage)).length,
  interviews: jobs.filter(job => INTERVIEWS.has(job.stage)).length});
// Opportunities that found you are not job matches: every match list leaves them out (Inbound is the list for them;
// the application counters above and a pasted link still reach them), and the active ones are "In conversation" above.
const OVER = new Set([...ENDED, 'Dismissed', 'Closed']);
export const matchesOnly = jobs => jobs.filter(job => !isInbound(job));
// The matches still to decide on: an applied job is an application (the Applied counters and menu list it), so Total
// matches, High fit, New this week, Companies and All matches leave it out.
export const openMatches = jobs => matchesOnly(jobs).filter(job => job.status !== 'applied');
// The list's "Show" menu: New matches (value open), Saved, Applied, Dismissed = job matches with that status; All
// matches (value all) = every job match, whatever its status; Inbound = every opportunity that found you, whatever
// its stage (they are not matches, so no match list shows them); Everything (value everything) = the two sets together,
// the only list that holds both kinds.
export function inStatus(job, filter) {
  if (filter === 'all' || filter === 'everything') return true;
  if (filter === 'inbound') return isInbound(job);
  return job.status === (filter === 'open' ? 'unreviewed' : filter);
}
export const inboundCount = jobs => jobs.filter(isInbound).length;
// The four counters above the list (df 2/2, owner 13 Nov 2026: "only 4 cards"): Total matches and Applied ARE menu lists ('all', 'applied'), so their number is the menu's own
// countFor and a click shows exactly those rows; New (the last Find jobs run) and Interviews are counter lists (byStat). One rule per number.
const MENU_CARD = {total: 'all', applied: 'applied'};
// A counter clicked above the list: the list it filters to (stat) and the menu's value. The active counter again, or Total matches, shows every match.
export function statClick(kind, active, filter) {
  if (MENU_CARD[kind]) return {stat: null, filter: MENU_CARD[kind]};
  return {stat: kind === active ? null : kind, filter: 'all'};
}
/** True when a card is the pressed one: its counter list is active, or (no counter) it is the menu list shown (`filter`, the sole ticked filter; '' when several). Pure, from the state the page holds. */
export const statPressed = (kind, active, filter) => kind === active || (!active && MENU_CARD[kind] === filter);
/** The matches the latest Find jobs run added: first seen at or after the run's start (ISO). No run known: none. One rule for the New card, its list and the header's "n new matches".
 *  Only the loaded rows count: the engine sends the best 200, so a low-fit new job beyond the cut is missed. */
export const freshSince = (jobs, since) => (since ? openMatches(jobs).filter(job => Date.parse(job.first_seen_at) >= Date.parse(since)) : []);
export const byFilter = (jobs, filter) => (filter === 'inbound' || filter === 'everything' ? jobs : filter === 'all' ? openMatches(jobs) : matchesOnly(jobs))
  .filter(job => inStatus(job, filter));
// The list as it opens (the menu's "New matches"): the jobs waiting for a first look. The Jobs menu item carries this
// count — the same number the list bar shows under the page title, whatever the list is later filtered to.
export const toReview = jobs => byFilter(jobs, 'open').length;
// In conversation: a person is talking to you about it. Every open inbound opportunity (a recruiter's pitch included),
// and the jobs you applied to that reached a screening or interviews.
export const inConversation = jobs => jobs.filter(job => isInbound(job) ? !OVER.has(job.stage) : TALKING.has(job.stage))
  .sort((a, b) => (b.next_step ? 1 : 0) - (a.next_step ? 1 : 0) || String(a.company).localeCompare(String(b.company)));
// The In conversation bar: folded it is one line ("2 in conversation"), open it names the section and splits inbound / outbound.
// It starts folded (the job list comes up higher); only a saved "open" choice unfolds it.
export const talkingStartsOpen = stored => stored === '1';
export function talkingBar(talking, open) {
  const found = talking.filter(isInbound).length;
  return open ? {title: t('helperFlow.inConversation'), detail: t('helperFlow.conversationCounts', {count: talking.length, inbound: found, outbound: talking.length - found}), toggle: foldToggleWord(true)}
    : {title: t('helperFlow.conversationCount', {count: talking.length}), detail: '', toggle: foldToggleWord(false)};
}
// A job's status pill: its own status, except that an application shows where it stands in Notion (its Stage),
// e.g. Rejected rather than Applied.
const STATUS = {unreviewed: [t('helperFlow.new'), 'info'], saved: [t('helpers.savedPlain'), 'signal'], applied: [t('helpers.stageApplied'), 'good'], dismissed: [t('helpers.stageDismissed'), 'neutral']};
const STAGE_TONE = {Rejected: 'bad', Withdrawn: 'neutral', 'No response': 'neutral', Offer: 'good'};
export function statusPill(job) {
  if (job.ready && job.status !== 'applied') return {label: READY_LABEL, tone: 'good'};   // filled on the server, waiting for your Submit (pages/jobs-ready.js)
  if (job.stage === 'Rejected' && ['Asked for feedback', 'Received feedback'].includes(job.feedback_status)) {
    return {label: `${stageText('Rejected')} · ${t(job.feedback_status === 'Received feedback' ? 'helperFlow.receivedFeedback' : 'helperFlow.askedFeedback')}`, tone: job.feedback_status === 'Received feedback' ? 'info' : 'warn'};
  }
  if (job.stage === 'Recruiter lead') return {label: stageText('Recruiter lead'), tone: 'signal'};
  if (job.status === 'applied' && job.stage && job.stage !== 'Applied') {
    return {label: stageText(job.stage), tone: STAGE_TONE[job.stage] || (TALKING.has(job.stage) ? 'info' : 'good')};
  }
  const [label, tone] = STATUS[job.status] || [job.status, 'neutral'];
  return {label, tone};
}
// The application counters: applied (sent) in total, then where they stand: waiting for a reply, in process, closed.
// A job still "Applying" is not sent; it is a session in progress (or one to settle: isStuck).
export function applicationStats(jobs) {
  return Object.fromEntries(Object.entries(APPLICATION).map(([kind, test]) => [kind, jobs.filter(test).length]));
}

// Clicking a counter shows the jobs it counts: high fit, new this week, or one job per company (its best fit).
export function byStat(jobs, kind, now = Date.now(), since = '') {
  if (APPLICATION[kind]) return jobs.filter(APPLICATION[kind]);
  if (kind === 'fresh') return freshSince(jobs, since);
  if (kind === 'high') return jobs.filter(job => job.fit >= 70);
  if (kind === 'week') return jobs.filter(job => now - Date.parse(job.first_seen_at) <= WEEK);
  if (kind === 'companies') {
    const best = new Map();
    for (const job of jobs) {
      const key = (job.company || '').trim().toLowerCase();
      if (key && (!best.has(key) || (job.fit ?? -1) > (best.get(key).fit ?? -1))) best.set(key, job);
    }
    const keep = new Set(best.values());
    return jobs.filter(job => keep.has(job));
  }
  return jobs;
}

// The list order: best match (as the engine ranked it), newest first, by company, or the latest activity first (the
// Inbound list: tracked or applied most recently).
const lastActivity = job => Math.max(Date.parse(job.first_seen_at) || 0, Date.parse(job.applied_on) || 0);
export function sorted(jobs, by) {
  const list = [...jobs];
  if (by === 'activity') list.sort((a, b) => lastActivity(b) - lastActivity(a));
  if (by === 'newest') list.sort((a, b) => (Date.parse(b.first_seen_at) || 0) - (Date.parse(a.first_seen_at) || 0));
  if (by === 'company') list.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
  return list;
}

// A company's badge: its initials on a colour picked from its name, the same every time.
const HUES = [14, 200, 262, 152, 330, 38, 180, 4, 222, 96];
export function avatar(company) {
  const words = String(company || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  let hash = 0;
  for (const ch of String(company || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return {initials, hue: HUES[hash % HUES.length]};
}

// The work-mode chip: one word for the mode the source names ("Remote (stated)" reads Remote), else its own wording.
const MODES = [['remote', t('helperFlow.remote'), /remote/i], ['hybrid', t('helperFlow.hybrid'), /hybrid/i], ['onsite', t('helperFlow.onsite'), /on.?site/i]];
export function workMode(text) {
  const [kind, label] = MODES.find(([, , pattern]) => pattern.test(text || '')) || ['', String(text || '')];
  return {kind, label};
}

// The Notion page of an Applications row (its id, as the Interviews list gives it).
export const notionPageUrl = id => (id ? `https://www.notion.so/${String(id).replace(/-/g, '')}` : '');

// What the Job cell of an Interviews row shows and can do: the job in the list (opens in Jobs), a job that is
// only linked in Notion (opens in Notion), or none ("Link a job").
// An interview's application id → its job in the list: by the store's id (page_id: every store; on SQLite it is the only one) or by the
// Notion page in its URL. Pure, so a SQLite-shaped list is tested (test/unit/renderer/jobs-view-interview.test.js).
const plainId = id => String(id || '').replace(/-/g, '');
export const jobOfApplication = (jobs, pageId) => (!pageId ? undefined : (jobs || []).find(job => (job.page_id && plainId(job.page_id) === plainId(pageId))
  || (job.notion_url && plainId(job.notion_url).includes(plainId(pageId)))));

// links: the store has pages to open (Notion). Without, a linked job not in the list is said plainly and has no page link.
export function interviewJob(row, job, {links = true, linked = t('helperFlow.linkedNotion'), elsewhere = t('helperFlow.linkedJob')} = {}) {   // about Notion
  const page = row.application?.[0] || '';
  if (job) return {kind: 'job', name: job.company || job.title, role: job.company ? job.title : '', notion: job.notion_url || (links ? notionPageUrl(page) : '')};
  if (page) return {kind: links ? 'notion' : 'none', name: links ? linked : elsewhere, role: '', notion: links ? notionPageUrl(page) : ''};
  return {kind: 'none', name: t('helperFlow.noLinkedJob'), role: '', notion: ''};
}

// Place and mode on one line, without saying the mode twice ("Remote (Europe)" + Remote reads "Remote (Europe)").
export function placeAndMode(location, mode) {
  const {kind, label} = workMode(mode);
  const said = kind && MODES.find(([k]) => k === kind)[2].test(location || '');
  return [shortPlace(location).text, mode && !said ? label : ''].filter(Boolean).join(' · ');
}

// A posting may list a dozen countries ("Remote - European Union; Spain; Italy; …"): the row shows the first two and a count, and all of
// them on hover (`full`, empty when nothing was cut).
export function shortPlace(location, max = 2) {
  const parts = String(location || '').split(/\s*;\s*/).filter(Boolean);
  if (parts.length <= max) return {text: parts.join('; '), full: ''};
  return {text: `${parts.slice(0, max).join('; ')} +${parts.length - max}`, full: parts.join('; ')};
}

// Fit ring colour band.
export const band = fit => (fit == null ? 'none' : fit >= 70 ? 'high' : fit >= 50 ? 'mid' : 'low');

// The match words in a ring's tooltip and a board card.
export const matchLabel = fit => (fit == null ? t('helperFlow.notScored') : fit >= 70 ? t('helperFlow.strongMatch') : fit >= 50 ? t('helperFlow.goodMatch') : t('helperFlow.weakMatch'));

// The fit score's bands, a few words each: the same bands the scoring prompt states (src/ai/score.py; Notion "Fit score - the scoring
// rubric"). Shown as the tooltip of every place a fit score is drawn (the Jobs ring, a run card's score), with this job's own band first.
export const FIT_BANDS = [[85, t('helperFlow.everythingMatches')], [70, t('helperFlow.smallGaps')], [50, t('helperFlow.partialFit')], [30, t('helperFlow.mostlyOtherRole')], [0, t('helperFlow.unrelated')]];
export function fitTooltip(fit, extra = '') {
  const bands = FIT_BANDS.map(([from], i) => `${from}–${i ? FIT_BANDS[i - 1][0] - 1 : 100}  ${FIT_BANDS[i][1]}`);
  const head = fit == null ? t('helperFlow.notScoredYet') : t('helperFlow.fitScore', {fit, match: matchLabel(fit)});
  return [head, ...bands, ...(extra ? ['', extra] : [])].join('\n');
}

// Why a job has no score, for the ring's tooltip and the row's badge. place_unclear (src/desktop_jobs.py): its location is only a country and its
// posting could not be read, so no refresh can place or score it; it is listed for you to check, never hidden or closed (#323, 12 Oct 2026).
export const PLACE_UNCLEAR = t('helperFlow.placeUnclear');
export function unscoredWhy(job) {
  if (job.fit != null) return '';
  return job.place_unclear ? t('helperFlow.unscoredPlace')
    : t('helperFlow.unscoredDescription');
}

// When a job was first seen: "just now", "5h ago", "3d ago", "2w ago".
export function ago(iso, now = Date.now()) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return t('helperFlow.justNow');
  if (hours < 24) return t('helperFlow.hoursAgo', {count: hours});
  const days = Math.floor(hours / 24);
  return days < 14 ? t('helperFlow.daysAgo', {count: days}) : t('helperFlow.weeksAgo', {count: Math.floor(days / 7)});
}

// "Applying" that no open session explains: the session was closed without saying whether it was submitted.
export const isStuck = (job, hasSession) => job.stage === 'Applying' && !hasSession(job);

// Which jobs are having their kit drafted, by job code. The list re-renders whenever anything changes (a Skip, a Save, a
// reload), so "Preparing" can't live on the button: a rebuilt row asks here. 'local' = running on this computer,
// 'failed' = the last try failed (the row offers Retry).
export const preparing = new Map();
export const prepareState = (job, tracker = preparing) => {
  if (job.kit) { tracker.delete(job.code); return ''; }
  return tracker.get(job.code) || '';
};
// Jobs you saved or drafted a kit for that a refresh found Closed: their posting was taken down (the daily check, or a
// batch Apply that found it gone). Said in a pop-up, so a job you were looking at doesn't vanish without a word.
export function takenDown(before, after) {
  const was = new Map((before || []).filter(job => ['Saved', 'Kit ready'].includes(job.stage)).map(job => [job.url, job]));
  return (after || []).filter(job => job.stage === 'Closed' && was.has(job.url));
}
