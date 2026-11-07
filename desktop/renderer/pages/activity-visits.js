// Recent activity: the site-reading (visits) card and the busy-button memory (presses) its buttons share.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {cardHead, el} from '../components.js';
import {wand} from '../magic.js';
import {resumeOffered} from '../claude-help.js';
import {shared} from './shared.js';
import {$} from './core.js';
import {toastMessage} from './startup.js';
import {plural, runButton} from './activity-basics.js';
import {showJobsIn} from './jobs.js';
import {openView} from './nav.js';
import {openActivity} from './activity-panel.js';
import {plainError} from '../run-warnings.js';
// A button on a card Recent activity redraws (on every log line and refresh): what it is doing lives here by key, not on the button, so a redraw
// keeps "Starting Claude…" or its "✓", and the outcome lands on the button now on screen (7 Oct 2026: Read with Claude, then the few-jobs box,
// showed no loading: the busy button was replaced by a fresh one). Every such button goes through keepPress + pressWhile (a test checks).
const presses = new Map();          // key -> {busy, done, text, error}
const pressedButtons = new Map();   // key -> its button on screen now
function paintPress(key) {
  const state = presses.get(key), button = pressedButtons.get(key);
  if (!state || !button) return;
  if (state.text) button.textContent = state.text;
  button.disabled = !!(state.busy || state.done);
  button.toggleAttribute('aria-busy', !!state.busy);
}
export function keepPress(key, button) { pressedButtons.set(key, button); paintPress(key); return button; }
export function setPress(key, state) { presses.set(key, {...presses.get(key), ...state}); paintPress(key); }
export const pressedButton = key => pressedButtons.get(key);
const pressError = key => presses.get(key)?.error || '';
export async function pressWhile(key, busyText, work) {
  setPress(key, {busy: true, error: '', ...(busyText ? {text: busyText} : {})});
  try { return await work(); } finally { setPress(key, {busy: false}); }
}

// A Read with Claude session that finished or stopped: its button comes back, with what it read in the row (owner, 7 Oct 2026: "the button
// stays on 'Claude is reading in Chrome' even after the session ends"; "Read with Claude never reports back").
const claudeGroups = new Map();   // first site's address -> every site one "Read the stopped sites with Claude" session reads
function claudeReadEnded(url, said) {
  for (const each of claudeGroups.get(url) || [url]) claudeSiteEnded(each, said);
  claudeGroups.delete(url);
  const all = [...presses.keys()].find(key => key.startsWith('claude-all:') && key.includes(url));
  if (all) setPress(all, {done: false, text: presses.get(all).idle || t('pagesActivityMore.readClaude')});
}
function claudeSiteEnded(url, said) {
  const key = `claude:${url}`;
  if (!presses.get(key)?.done) return;
  setPress(key, {done: false, text: t('pagesCommon.readClaude'), error: said});
  const shown = pressedButton(key)?.closest('li')?.querySelector('.item-words, .site-words');
  shown?.querySelector('.visit-claude-error')?.remove();
  shown?.append(el('span', 'muted visit-claude-error', said));
}
window.pilot?.onVisitClaudeDone?.(result => {
  claudeReadEnded(result.url, t('pagesDynamicActivity.m40', {"jobs": result.jobs, "value3": (result.urls || []).length > 1 ? t('pagesDynamicActivity.fromSites', {count: result.urls.length}) : '', "fits": result.fits, count: result.jobs}));
  toastMessage(t('pagesDynamicActivity.m41', {"jobs": result.jobs, "value2": result.name || t('pagesDynamicActivity.site'), "fits": result.fits}),
    result.fits ? t('pagesActivityMore.matchingScored') : t('pagesActivityMore.noneMatch'), {view: 'jobs'}, 'good');
});
window.pilot?.onSession?.((event, payload) => {   // a session that stopped without finishing (closed, failed)
  if (event === 'update' && payload?.kind === 'read' && ['ended', 'failed'].includes(payload.status)) claudeReadEnded(payload.url, t('pagesDynamicActivity.m42', {"value1": payload.status === 'failed' ? t('pagesDynamicActivity.stopped') : t('pagesDynamicActivity.ended')}));
});

// A stopped site's "Read with Claude", the same in the result card's list and in the run's site rows (siteRow): one key per site, so a
// session started from either is followed in both. `words` gets the error line.
const WORDS = '.item-words, .site-words';
export function claudeReadButton(site, words) {
  const claude = el('button', 'secondary item-action', t('pagesCommon.readClaude'));
  claude.type = 'button';
  wand(claude);
  claude.title = t('pagesActivityMore.oneSiteClaude');
  // Starting a Claude session takes ~10 s (owner, 7 Oct 2026: "I press, nothing happens"): said on the button, the way Re-score does it,
  // then it stays off while that session reads; a refusal is said in the row.
  const key = `claude:${site.url}`;
  keepPress(key, claude);
  if (pressError(key)) words.append(el('span', 'muted visit-claude-error', pressError(key)));
  claude.addEventListener('click', async () => {
    const started = await pressWhile(key, t('pagesCommon.startingClaude'), () => window.pilot.visitWithClaude(site.url, site.name)).catch(error => ({ok: false, error: error.message}));
    if (started?.ok) { setPress(key, {done: true, text: t('pagesCommon.claudeReading')}); return; }
    setPress(key, {text: t('pagesCommon.readClaude'), error: plainError(started?.error || t('pagesCommon.claudeFailed'))});
    const shown = pressedButton(key)?.closest('li')?.querySelector(WORDS);
    shown?.querySelector('.visit-claude-error')?.remove();
    shown?.append(el('span', 'muted visit-claude-error', pressError(key)));
  });
  return claude;
}

// "View jobs" on a site that read more than one new job (owner, 13 Oct 2026): Jobs filtered to what this run added from that site (its company, first
// seen since the run started). Shared by the result card's rows and the step card's site rows. Only jobs that fit the search reach Jobs, so it
// says so when none did. `text`: the row's own words ("50 jobs (50 new), 1 matching your search").
const sameCompany = (a, b) => { const x = String(a || '').toLowerCase().trim(), y = String(b || '').toLowerCase().trim(); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
export function viewJobsButton(site, text, since) {
  const fresh = Number(/(\d+) new/.exec(text || '')?.[1] || 0);
  if (fresh < 2) return null;
  const button = el('button', 'link item-action', t('pagesStatus.viewJobs'));
  button.type = 'button';
  button.title = t('pagesDynamicActivity.m43', {"name": site.name});
  button.addEventListener('click', () => {
    const from = Date.parse(since || '') || 0;
    const urls = (shared.allJobs || []).filter(job => sameCompany(job.company, site.name) && (!from || Date.parse(job.first_seen_at) >= from - 60000)).map(job => job.url);
    if (!urls.length) { toastMessage(t('pagesDynamicActivity.m44', {"name": site.name}), t('pagesDynamicActivity.m45', {"fresh": fresh}), {activity: true}, 'info'); return; }
    openActivity(false);
    openView('jobs');
    showJobsIn(t('pagesDynamicActivity.m46', {"name": site.name}), urls, 'activity');
  });
  return button;
}

// "Find jobs using your browser" (renderer/visits-card.js): the counts, a row per site read, and a stopped site's ways on (owner's mockup,
// 7 Oct 2026): Read with Claude (a Claude in Chrome session, when the extension could not) and Open it myself.
// list: false when the run's step card already lists the sites with their marks and buttons (Recent activity), so they are not shown twice
// (owner, 7 Oct 2026); the Actions page has no step card and keeps the list.
export function renderVisitsCard(card, target = $('activity-card'), {list: withList = true} = {}) {
  const box = el('div', 'insight-card');
  const onlyPostings = !card.total && card.postings;   // a run of "Jobs we couldn't read" only: no site was ticked
  // The reading works, said first; how many reach Jobs beside it (owner). How many reach Jobs, said plainly (owner, 7 Oct 2026: "Read 5 jobs, but
  // my Jobs count never grows"): only those with your role words and places. Postings only your browser could open (lib/visits.js readPostings):
  // how many were read, said under the sites' line; scored with them above.
  const head = cardHead(t('pagesExtraCommon.sitesOnlyYou'), onlyPostings ? t('pagesDynamicActivity.m47', {"read": card.postings.read, "plural": plural(card.postings.asked, 'job')}) : card.fits === null ? t('pagesShortActivity.m55', {"read": card.read, "plural": plural(card.total, 'site'), "plural3": plural(card.jobs, 'job'), "fresh": card.fresh})
    : t('pagesDynamicActivity.m48', {"plural": plural(card.jobs, 'job'), "fits": card.fits}), {subtitles: [card.fits === null ? t('pagesAuditFirst.a23')
    : t('pagesShortActivity.m56', {"read": card.read, "plural": plural(card.total, 'site')}) + (card.fits && card.listed !== null && card.listed !== undefined
      ? t('pagesDynamicActivity.m49', {"plural": plural(card.listed, 'job'), "value2": card.listed < card.fits ? t('pagesDynamicActivity.othersNotAdded') : ''})
      : card.fits ? (card.fits === 1 ? t('pagesAuditFirst.a24') : t('pagesAuditFirst.a25'))
      : t('pagesActivityMore.noneMatch')),
    card.postings && !onlyPostings && t('pagesDynamicActivity.m50', {"read": card.postings.read, "asked": card.postings.asked})]});
  // Two or more stopped sites: one Claude session reads them all, in turn (owner, 7 Oct 2026: "a 'Read the failed sites with Claude' button").
  const stopped = card.sites.filter(site => !site.ok).slice(0, 10);   // one session reads at most 10 (main.js visitsWithClaude)
  const allStopped = card.sites.filter(site => !site.ok).length;
  const ways = el('div', 'visits-claude-all inline');
  // Run again, the stopped sites ticked (owner, 8 Oct 2026: a run that read 2 of 4 had no Run again): the dialog opens with them, as the failure
  // box's Run again does for a failed run (shared.visitsPreselect, pages/actions.js).
  if (allStopped && card.sites.some(site => site.ok)) {
    const again = el('button', 'secondary', t('pagesDynamicActivity.m51', {"value1": allStopped === 1 ? t('pagesDynamicActivity.stoppedSite') : t('pagesDynamicActivity.m52', {allStopped})}));
    again.type = 'button';
    again.title = t('pagesActivityMore.openBrowserFind');
    again.addEventListener('click', () => {
      shared.visitsPreselect = card.sites.filter(site => !site.ok).map(site => ({name: site.name, url: site.url}));
      runButton('visits')?.click();
    });
    ways.append(again);
  }
  if (stopped.length > 1 && resumeOffered()) {   // only with Claude help on (claude-help.js)
    const idle = allStopped > stopped.length ? t('pagesDynamicActivity.m53', {"length": stopped.length, "allStopped": allStopped}) : t('pagesDynamicActivity.m54', {"length": stopped.length});
    const all = el('button', 'secondary', idle);
    all.type = 'button';
    all.title = t('pagesActivityMore.manySitesClaude');
    const key = `claude-all:${stopped.map(site => site.url).join(' ')}`;
    keepPress(key, all);
    presses.set(key, {...presses.get(key), idle});
    all.addEventListener('click', async () => {
      const started = await pressWhile(key, t('pagesCommon.startingClaude'), () => window.pilot.visitsWithClaude(stopped.map(site => ({url: site.url, name: site.name})))).catch(error => ({ok: false, error: error.message}));
      if (!started?.ok) { setPress(key, {text: idle, error: plainError(started?.error || t('pagesCommon.claudeFailed'))}); toastMessage(t('pagesStatus.claudeNotStarted'), started?.error || '', {activity: true}, 'bad'); return; }
      setPress(key, {done: true, text: t('pagesDynamicActivity.m55', {"length": stopped.length})});
      claudeGroups.set(stopped[0].url, stopped.map(site => site.url));
      for (const site of stopped) setPress(`claude:${site.url}`, {done: true, text: t('pagesCommon.claudeReading')});
    });
    ways.append(all);
  }
  if (ways.children.length) head.append(ways);
  const list = el('ul', 'item-rows');
  for (const site of card.sites) {
    const row = el('li', site.ok ? '' : 'is-failed');
    row.append(el('span', `site-mark ${site.ok ? 'done' : 'fail'}`));   // the run's ✓ / ✕, as in its live rows
    const words = el('div', 'item-words');
    words.append(el('b', '', site.name), el('span', 'muted', site.detail));
    row.append(words);
    if (!site.ok) {
      const claude = resumeOffered() ? claudeReadButton(site, words) : null;   // only with Claude help on (claude-help.js)
      const myself = el('button', 'link item-action', t('pagesCommon.openMyself'));
      myself.type = 'button';
      myself.addEventListener('click', () => window.pilot.openVisit(site.url));
      row.append(...[claude, myself].filter(Boolean));
    } else {   // a site read: open it yourself too, the same link in the same place
      const myself = el('button', 'link item-action', t('pagesCommon.openMyself'));
      myself.type = 'button';
      myself.addEventListener('click', () => window.pilot.openVisit(site.url));
      row.append(...[viewJobsButton(site, site.detail, card.since), myself].filter(Boolean));
    }
    list.append(row);
  }
  box.append(...(withList ? [head, list] : [head]));
  target.replaceChildren(box);
}
