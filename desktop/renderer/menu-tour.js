// The first-launch menu tour: which stops, in which order, and whether it was seen. Never shown again once done or skipped. Guarded by test/unit/renderer/menu-reveal.test.js.
export const STOPS = [
  {id: 'focus', target: '.nav[data-view="focus"]', title: 'Focus', text: 'What needs you today, most important first.'},
  {id: 'jobs', target: '.nav[data-view="jobs"]', title: 'Jobs', text: 'Your matches. Find jobs starts here.'},
  {id: 'applying', target: '.nav[data-view="sessions"]', title: 'Applying', text: 'The forms the extension fills in for you. You press Submit.'},
  {id: 'actions', target: '.nav[data-view="actions"]', title: 'Actions', text: 'Run a search, check Gmail, tailor CVs.'},
  {id: 'more', target: '#nav-more-head', title: 'More', text: 'Pages that unlock as you go. Open it to see when.'},
  // Why (fb 6/7, 5 Nov 2026, spec report-instead-of-leaving): the first thing a person who hits a problem should know is that telling us is one click; the promise is true since 1/7 (a receipt, then an answer within 24 hours).
  {id: 'feedback', target: '#nav-feedback', title: 'Send feedback', text: 'Something wrong or missing? Tell us here. We read every report and write back within a day.'},
  // Why (owner, 5 Nov 2026: "we should include also the theme icon (dark/light) in the virtual tour" and "the panel sidebar collapse/expand"): the two other buttons beside Send feedback were never explained.
  {id: 'theme', target: '#theme-toggle', title: 'Light or dark', text: 'Switch the look of the app.'},
  {id: 'collapse', target: '#rail-toggle', title: 'Menu size', text: 'Shrink the menu to icons, or open it again.'},
  {id: 'palette', target: '#palette-hint', title: 'Search & commands', text: 'Type to find any page or command.'},   // owner, 5 Nov 2026: "and the search and commands"
];
/** The card's top edge (px) beside a stop whose box is at `top` with `height`: level with the stop, never above 8 and never so low that its `cardHeight` runs past the window's `viewportHeight` (the Send feedback stop sits at the foot of the sidebar). */
export const cardTop = (top, height, cardHeight, viewportHeight) => Math.max(8, Math.min(Math.round(top + height / 2 - 40), viewportHeight - cardHeight - 8));
export const STEP_MS = 3000;   // nine stops, about 27 seconds
// Only the stops whose target is on screen now (More is gone once everything is unlocked; the icon rail has no More).
export const stopsFor = present => STOPS.filter(stop => present(stop.target));
const KEY = 'jp.menu.tour';
export const seen = storage => { try { return storage.getItem(KEY) === 'done'; } catch { return true; } };   // storage blocked: do not nag
// A screenshot run (lib/e2e-hidden.js captureQuery: `?capture=1`) never shows the tour: it covered the sidebar in PR shots (owner, 17 Oct 2026).
export const captureRun = search => new URLSearchParams(search || '').has('capture');
export const markSeen = storage => { try { storage.setItem(KEY, 'done'); } catch { /* ignore */ } };
