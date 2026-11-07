import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The first-launch menu tour: which stops, in which order, and whether it was seen. Never shown again once done or skipped. Guarded by test/unit/renderer/menu-reveal.test.js.
export const STOPS = [
  {id: 'focus', target: '.nav[data-view="focus"]', title: t('helperGuide.focusTitle'), text: t('helperGuide.tourFocus')},
  {id: 'jobs', target: '.nav[data-view="jobs"]', title: t('helperGuide.jobsTitle'), text: t('helperGuide.tourJobs')},
  {id: 'applying', target: '.nav[data-view="sessions"]', title: t('helpers.stageApplying'), text: t('helperGuide.tourApplying')},
  {id: 'actions', target: '.nav[data-view="actions"]', title: t('helpers.actions'), text: t('helperGuide.tourActions')},
  {id: 'more', target: '#nav-more-head', title: t('helperGuide.moreTitle'), text: t('helperGuide.tourMore')},
  // Why (fb 6/7, 5 Nov 2026, spec report-instead-of-leaving): the translated tour still explains the one-click feedback path first when a problem happens, preserving the 1/7 receipt and reply-within-a-day promise.
  {id: 'feedback', target: '#nav-feedback', title: t('helperGuide.sendFeedback'), text: t('helperGuide.tourFeedback')},
  // Why (owner, 5 Nov 2026: "we should include also the theme icon (dark/light) in the virtual tour" and "the panel sidebar collapse/expand"): localized labels explain both existing buttons beside Send feedback; their targets and tour order stay the same.
  {id: 'theme', target: '#theme-toggle', title: t('helperGuide.lightDark'), text: t('helperGuide.tourTheme')},
  {id: 'collapse', target: '#rail-toggle', title: t('helperGuide.menuSize'), text: t('helperGuide.tourMenu')},
  {id: 'palette', target: '#palette-hint', title: t('helperGuide.searchCommands'), text: t('helperGuide.tourPalette')},   // owner, 5 Nov 2026: "and the search and commands"
  // Why (owner, 5 Nov 2026: "we should present these 2 bars ... so that the user knows about them"): the localized tour keeps both footer bars; `above` still places their cards over the bars along the window’s foot.
  {id: 'sessions', target: '#sessions-dock', above: true, title: t('helperGuide.applicationSessions'), text: t('helperGuide.tourSessions')},
  {id: 'activity', target: '#activity', above: true, title: t('helperGuide.lastNextRefresh'), text: t('helperGuide.tourRefresh')},
];
/** Where the card goes: {top, left} in px for a stop whose box is `rect` ({top, right, height}), the sidebar's right edge `sidebarRight`, the card's size and the window's. Beside the menu and level with the stop (the menu's own buttons),
 *  or `above` the stop (the bars at the foot); never above 8px, never past the bottom or right edge. Why (code review of fb 6/7, 5 Nov 2026): the Send feedback stop at the foot of the sidebar ran past the window's bottom. */
export function cardSpot({rect, sidebarRight, cardWidth, cardHeight, viewport, above = false}) {
  const room = Math.max(8, viewport.height - cardHeight - 8), left = Math.max(8, Math.min(Math.round(sidebarRight + 12), viewport.width - cardWidth - 8));
  const top = above ? Math.round(rect.top - cardHeight - 12) : Math.round(rect.top + rect.height / 2 - 40);
  return {top: Math.max(8, Math.min(top, room)), left};
}
export const STEP_MS = 3000;   // eleven stops, about 33 seconds
// Only the stops whose target is on screen now (More is gone once everything is unlocked; the icon rail has no More).
export const stopsFor = present => STOPS.filter(stop => present(stop.target));
/** The index of the first stop at or after `from` whose target is on screen now, or stops.length. Why (code review of fb 6b/7, 5 Nov 2026): stops are chosen once at the start; a person who opens the Sessions page mid-tour hides the tray, and the card then pointed at nothing. */
export function nextPresent(stops, from, present) {
  let at = from;
  while (at < stops.length && !present(stops[at].target)) at += 1;
  return at;
}
const KEY = 'jp.menu.tour';
export const seen = storage => { try { return storage.getItem(KEY) === 'done'; } catch { return true; } };   // storage blocked: do not nag
// A screenshot run (lib/e2e-hidden.js captureQuery: `?capture=1`) never shows the tour: it covered the sidebar in PR shots (owner, 17 Oct 2026).
export const captureRun = search => new URLSearchParams(search || '').has('capture');
export const markSeen = storage => { try { storage.setItem(KEY, 'done'); } catch { /* ignore */ } };
