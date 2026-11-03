// The one registry of "Send feedback → Include this screen's data": a page key → a function that returns what that page holds right now, so a bug can be debugged from it.
// Pure parts only (the registry, the screen key, row builders); the pages are registered in pages/feedback-screens.js, never in the dialog. A page with no entry sends its visible text.
// Why (2 Nov 2026, owner: "send the content/data from that page or which is relevant to debug. If we're on the jobs list, we should probably send the jobs list"): a screenshot
// does not show ids, filters, states or what a list hid. Never a posting's text (owner, 20 Oct 2026: no job texts stored centrally): ids, titles, companies, fit, status only.
const entries = new Map();
export const MAX_ROWS = 300, VISIBLE_TEXT = 20000;
// Why (Gitar on #3021, 3 Nov 2026): Settings and every Profile tab show the person's CV, details, letters and connections; their text must never ride along as "this screen's data".
// Profile contents go only through the opt-in snapshot, so these views send nothing unless a page registers a safe summary.
const PRIVATE_VIEWS = new Set(['settings', 'profile']);

/** Registers what a page sends: `read()` returns a JSON-able object (or null when the page has nothing yet). One entry per key. */
export function registerScreenData(key, read) { entries.set(String(key), read); }

/** The key of the screen the person is on: the active sidebar view, and for Profile the open tab (`profile:answers` = What we learned). */
export function screenKey(doc = document) {
  const nav = doc.querySelector('.nav.active');
  const view = nav?.dataset.view || '';
  if (view === 'settings' && nav?.dataset.settings === 'profile') return `profile:${doc.querySelector('[data-profile-tab].is-active')?.dataset.profileTab || 'cv'}`;
  return view;
}

/** What this screen sends: {screen, source: 'registry' | 'visible text' | 'none', data}. A registered page that throws or has nothing falls back to its visible text, except Settings and the
 *  Profile tabs (PRIVATE_VIEWS), which fall back to nothing: data is null. */
export function readScreenData(key = screenKey(), doc = document) {
  let data = null;
  try { data = entries.get(key)?.() ?? null; if (data) data = JSON.parse(JSON.stringify(data)); } catch { data = null; }   // plain JSON or nothing: a page's data crosses to the main process
  if (data) return {screen: key, source: 'registry', data};
  const view = key.split(':')[0];
  if (PRIVATE_VIEWS.has(view)) return {screen: key, source: 'none', data: null};
  const text = (doc.querySelector(`.view[data-view="${view}"]`)?.innerText || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, VISIBLE_TEXT);
  return {screen: key, source: 'visible text', data: {text}};
}

// A value as the feedback may carry it: a short primitive (a text is cut at 200 characters, so a posting or a letter cannot ride along whole).
const SHORT = 200;
/** A value as the feedback may carry it: a string cut at 200 characters, a number or a boolean as is; anything else (an object, null) is dropped (undefined). */
export const small = value => (typeof value === 'string' ? value.slice(0, SHORT) : typeof value === 'number' || typeof value === 'boolean' ? value : undefined);
const pick = (object, names) => Object.fromEntries(names.map(name => [name, small(object?.[name])]).filter(([, value]) => value !== undefined && value !== ''));

/** The Jobs list as the person sees it: how it is narrowed and sorted, then each row's ids, title, company, source, fit and status (never the posting). `origin` is the page's own reading. */
export function jobsData({rows = [], total = 0, filters = [], statFilter = null, text = '', sort = '', mode = '', origin = () => '', searching = false, lastSearchAt = ''} = {}) {
  return {
    view: {filters, counter: typeof statFilter === 'string' ? statFilter : statFilter ? 'custom list' : '', search: small(text), sort, mode, shown: rows.length, ofAll: total},
    refresh: {running: !!searching, lastSearchAt: small(lastSearchAt)},
    jobs: rows.slice(0, MAX_ROWS).map(job => ({...pick(job, ['code', 'id', 'url', 'title', 'company', 'source', 'stage', 'status', 'fit', 'place_unclear', 'applied_at']), origin: origin(job)})),
    ...(rows.length > MAX_ROWS ? {cut: `${rows.length - MAX_ROWS} more rows not listed`} : {}),
  };
}

/** What we learned: each question with its id, wording, the field it fills (the kind), the saved value and the verdict (its state), then how the page is narrowed. */
export function answersData({sections = [], learned = [], view = '', query = '', kindOf = () => ''} = {}) {
  return {
    view: {tab: view, search: small(query)},
    questions: sections.flatMap(section => section.items.filter(item => item.kind !== 'note').map(item => ({
      id: item.id, section: small(section.title), question: small(item.question), field: kindOf(item) || '', value: small(item.value), verdict: item.state || (item.guess ? 'guess' : item.value ? 'confirmed' : 'not set'), open: !!item.open}))).slice(0, MAX_ROWS),
    toCheck: learned.slice(0, MAX_ROWS).map(each => ({key: small(each.key), question: small(each.question), company: small(each.company), state: small(each.details?.kind || each.state || 'new')})),
  };
}

const OPTIONS_SHOWN = 20;
/** The open questions as the app has loaded them (renderer/pages/jobs-questions.js `now`): both drawers' items with the key the drawer answers by, what they ask, the field kind, its options, the saved value
 *  and, for Your details, the review kind (open | contact | missing | check …). Hidden and dismissed questions are only counted. Why (3 Nov 2026, desktop AI MCP): the write tools validate against this same list. */
export function questionsData({details = [], learned = [], dismissed = {}} = {}) {
  const row = list => item => ({list, key: small(item.key ?? item.id), question: small(item.question), kind: small(item.format?.kind) || '', ...(item.format?.options?.length ? {options: item.format.options.slice(0, OPTIONS_SHOWN).map(small).filter(Boolean)} : {}),
    value: small(item.value ?? item.answer) ?? '', hint: small(item.hint) || '', review: small(item.details?.kind) || '', state: small(item.state) || ''});
  return {questions: [...details.map(row('details')), ...learned.map(row('learned'))].slice(0, MAX_ROWS), dismissed: [...(dismissed.details || []), ...(dismissed.learned || [])].length};
}

/** Focus: the cards in the order shown, each as its short fields (job, company, step …). */
export const focusData = items => ({cards: (items || []).slice(0, MAX_ROWS).map(item => pick(item, Object.keys(item || {})))});
