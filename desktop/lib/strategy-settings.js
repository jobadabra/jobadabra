// Strategy, saving and tuning: accepting a draft (Profile, answers, search settings), the ⚙️ Search settings page, the daily target, widening
// (roles, places), loosening and Tune. Re-exported by strategy.js. Guarded by desktop/test/unit/main/strategy-roles.test.js, strategy-targets.test.js,
// strategy-remote.test.js, notion-trying.test.js and tune.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as contactDetails from './contact.js';
import * as notion from './notion.js';   // Notion-only: the Profile/answers texts and ⚙️ Search settings page when Notion is the store
import * as notionGate from './notion-gate.js';
import {withoutNotes} from './config-text.js';
import {remoteWordOf} from './strategy-rebuild.js';
import {writePrivate} from './private-file.js';
import {log as appLog} from './log.js';
import {dropFragment, editTitles, hasFragment, titlesOf, view as viewRoles, withDerived} from './target-roles.js';

// Accepting a draft writes the Profile, answers and the pipeline's settings into the user's folder.
// The Profile and standard answers: the Notion pages once Notion is connected (the only copy). Before that (Trying, see
// lib/notion-gate.js) this Mac's profile.md / answers.md, which lib/migrate.js moves into Notion at connect.
export async function profileTexts(storage) {
  if (!notionGate.notionInUse(storage)) return {profile: storage.readText('profile.md'), answers: storage.readText('answers.md')};
  const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
  const [profile, answers] = await Promise.all([notion.pageText(token, ids.NOTION_PROFILE_PAGE_ID),
    ids.NOTION_ANSWERS_PAGE_ID ? notion.pageText(token, ids.NOTION_ANSWERS_PAGE_ID) : '']);  // kept pages (lib/notion.js)
  return {profile, answers};
}
// Trying: the strategy's Profile (with its contact section) and standard answers are written to this Mac. null leaves a
// file as it is; backup first copies the files being replaced to backup/strategy-<stamp>/ and returns that folder (else null).
export function saveLocal(storage, {profile = null, answers = null}, {backup = false} = {}) {
  const files = [['profile.md', profile], ['answers.md', answers]].filter(([, text]) => text != null);
  let folder = null;
  if (backup) {
    const there = files.filter(([name]) => storage.readText(name));
    if (there.length) {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
      folder = storage.path(`backup/strategy-${stamp}`);
      fs.mkdirSync(folder, {recursive: true});
      for (const [name] of there) writePrivate(path.join(folder, name), storage.readText(name));
    }
  }
  for (const [name, text] of files) storage.writeText(name, text);
  return folder;
}
// Trying: an accepted draft kept on this Mac (the window's saveStrategy without Notion, lib/strategy-draft-handlers.js; the plain-node app of the e2e harness seeds
// its applicant through it: e2e/lib/offline-app-child.mjs). parts: the accepted groups (search, filters, profile, answers), null = everything (first setup).
// The Profile carries the draft's contact as its contact section. -> the backup folder of the replaced files, or null.
export function keepLocally(storage, draft, parts = null) {
  const take = part => !parts || parts.includes(part);
  const perDay = storage.settings().questionnaire?.applications_per_day;   // the daily target asked in the wizard goes with the search settings
  save(storage, {search: take('search') ? draft.search : null,
    preferences: !parts ? {...draft.preferences, daily_applications_target: clampTarget(perDay)} : take('filters') ? draft.preferences : null});
  const contact = Object.fromEntries(Object.entries(draft.contact || {}).filter(([, value]) => value));
  const profile = draft.profile_markdown.trim() + (Object.keys(contact).length ? `\n\n${contactDetails.markdown(contact)}\n` : '\n');
  return saveLocal(storage, {profile: take('profile') ? profile : null, answers: take('answers') ? draft.answers_markdown : null}, {backup: !!storage.settings().setupDone});
}
// Copies an older version kept on the Mac go once Notion has them (lib/migrate.js).
export function dropLocalCopies(storage) {
  // Logged (25 Oct 2026, beta 0.8.30: the settings suite's export held no profile.md or answers.md, and nothing said who removed them).
  const present = ['profile.md', 'answers.md'].filter(name => fs.existsSync(storage.path(name)));
  if (present.length) appLog('files', 'local copies dropped, the store has them', {files: present});
  for (const name of ['profile.md', 'answers.md']) fs.rmSync(storage.path(name), {force: true});
}

// ⚙️ Search settings: a readable Notion page next to the Profile (src/notion/search_settings.py parses it before
// every crawl; config/search.json and preferences.json are only its cache). Created when missing, and
// rewritten from the cached settings (e.g. after a strategy is rebuilt from the CV).
// given: {search, preferences} to render the page from instead of the files (saveSettings: the files do not hold them yet).
export async function publishSearchSettings(storage, {run, ensurePage, writePage}, given = null) {
  const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
  if (!notionGate.notionInUse(storage) || !token || !ids.NOTION_PROFILE_PAGE_ID) return null;   // the settings' page only in a Notion store
  let page = ids.NOTION_SEARCH_SETTINGS_PAGE;
  if (!page) {
    page = await ensurePage(token, ids.NOTION_PROFILE_PAGE_ID, SEARCH_SETTINGS_TITLE, '');
    storage.saveSettings({notionIds: {...storage.settings().notionIds, NOTION_SEARCH_SETTINGS_PAGE: page}});
  }
  await writePage(token, page, await renderPage(storage, run, given));
  forgetPageCopy(storage, page);
  return page;
}
// The page as markdown. given goes to the engine in a file of its own (an env var or an argument would hit Windows' length limits), in a folder made for this one call.
// Why (5 Nov 2026, #3186, Gitar): a throwaway file is not a writePrivate file: writePrivate may queue a write for later (Windows holds a file) and write it after this call has
// given up, leaving the settings in the temp folder; and {mode} on a file path trips the privacy guard. A folder from mkdtemp is 0700 and new, so the plain write inside it is private, and
// removing the folder removes everything, whatever happened.
async function renderPage(storage, run, given) {
  let folder = '';
  try {
    const args = ['src.notion.search_settings', 'render'];
    if (given) {
      folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-settings-'));
      const file = path.join(folder, 'settings.json');
      fs.writeFileSync(file, JSON.stringify(given));
      args.push('--from', file);
    }
    const {code, stdout} = await run(storage, args);
    if (code !== 0 || !stdout.trim()) throw new Error('Could not render the search settings');
    return stdout;
  } finally {
    if (folder) try { fs.rmSync(folder, {recursive: true, force: true}); } catch {}
  }
}

// Every change of the search or preference settings is saved here, Notion first, then this Mac (owner, 3 Nov 2026: "Notion first, then here"; main e2e run
// 41537996714: copy first left a window in which a pull of the old page, started by the window's Focus, put the saved place back out: "−lugano").
// Design: states — saved here and on the page / the page being written (the copy still the old one) / refused (both as they were).
//   One owner: this function. The page is rendered from the NEW settings in memory, written, and only then are config/search.json and preferences.json
//   written. A pull that lands before the page is whole reads the old page and leaves the old copy; one that lands after reads the new page. What a pull
//   mid-write (lib/notion-write.js deletes the blocks, then appends in passes) puts into the copy for a moment is replaced by the whole settings right after.
//   No Notion store: the copy only, as before. A refused page write throws with error.copyUnchanged = true and writes nothing here (the page itself is lib/notion-write.js's: a refusal
//   after it deleted blocks leaves it partial, and the next pull of this Mac's unchanged copy would not repair it; the person retries the save).
// search, preferences: the whole new file content, null = leave that file alone.
export async function saveSettings(storage, {search = null, preferences = null}, deps) {
  const files = {search, preferences};
  const current = name => JSON.parse(storage.readText(SETTINGS_FILES[name]) || '{}');   // a missing file is {}; a corrupt one throws, never blanks the page (the engine's own render did too)
  try {
    await publishSearchSettings(storage, deps, {search: search ?? current('search'), preferences: preferences ?? current('preferences')});
  } catch (error) {
    error.copyUnchanged = true;
    appLog('notion', 'search settings page not written; this Mac\'s copy left as it was', {error: error.message});
    throw error;
  }
  for (const [name, content] of Object.entries(files)) if (content) storage.writeText(SETTINGS_FILES[name], JSON.stringify(content, null, 2) + '\n');
}
const SETTINGS_FILES = {search: 'config/search.json', preferences: 'config/preferences.json'};
// Target roles, one list (21 Oct 2026): a settings file that still has the two lists (roles, job board searches) is merged once by the engine, which asks
// the AI which short forms are the same job (src/target_roles.py, a few cents at most); then the Notion page is rewritten from the file. Returns whether it merged.
export async function oneRolesList(storage, deps) {
  let search;
  try { search = JSON.parse(storage.readText('config/search.json') || '{}'); } catch { return false; }
  if (Array.isArray(search.target_roles) || !viewRoles(search).length) return false;
  const {stdout} = await deps.run(storage, ['src.target_roles', 'migrate']);
  if (!/merged/.test(stdout)) return false;   // no AI now: the two lists keep working, asked again next time
  await publishSearchSettings(storage, deps);
  return true;
}
// The engine keeps a copy of each Notion page it read (src/notion/client.py _kept_page_text). Just written, that copy is old: dropped, so the next
// search reads the page itself (7 Oct 2026: a copy from the minute of an earlier save brought "suisse" back on every search).
export function forgetPageCopy(storage, page) {
  for (const id of new Set([String(page), String(page).replace(/-/g, '')])) {
    try { fs.rmSync(storage.path('data', 'cache', 'notion-pages', `${id}.json`), {force: true}); } catch {}
  }
}
export const SEARCH_SETTINGS_TITLE = '⚙️ Search settings';

// The daily applications target (Focus, reminders) is a line of ⚙️ Search settings. The page is read first
// (edits made in Notion are kept), then saved with the new value (saveSettings: Notion first, then the copy).
export const DEFAULT_TARGET = 5;  // fewer, better applications: a handful of good-fit ones a day
export const clampTarget = value => Math.max(1, Math.min(200, Math.round(Number(value)) || DEFAULT_TARGET));
export function dailyTarget(storage) {
  try { return clampTarget(JSON.parse(storage.readText('config/preferences.json') || '{}').daily_applications_target); }
  catch { return DEFAULT_TARGET; }
}
export async function setDailyTarget(storage, value, {run, ensurePage, writePage}) {
  const target = clampTarget(value);
  await run(storage, ['src.notion.search_settings', 'sync']);
  const preferences = JSON.parse(storage.readText('config/preferences.json') || '{}');
  await saveSettings(storage, {preferences: {...preferences, daily_applications_target: target}}, {run, ensurePage, writePage});   // refused: the copy is untouched
  return target;
}

// Role terms the user chose to add after the app said the search was narrow (src/coverage.py). Like the daily target they live in
// ⚙️ Search settings: the page is read first (edits made in Notion are kept), the terms are added, then saved with saveSettings (Notion first, then the copy;
// Notion refusing changes neither).
export const ROLE_TERM = /^\p{L}[\p{L}0-9+#.\- ]{1,38}[\p{L}0-9+#]$/iu;   // any language's letters: "ingénieur système", "systemtechniker"
export const escapeRegex = term => term.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
export function addRoles(storage, terms, deps) {
  const wanted = [...new Set((Array.isArray(terms) ? terms : []).map(term => String(term).trim().toLowerCase()).filter(term => ROLE_TERM.test(term)))].slice(0, 10);
  return widen(storage, wanted.map(term => ({label: term, fragment: term})), titlesOf, (search, titles) => editTitles(search, {add: titles}), deps);   // one list of titles (lib/target-roles.js)
}

// Places the app offered after a search (src/coverage.py PLACE_OPTIONS): the caller passes the offered fragments only. They join
// locations.abroad, the same list the Berlin/London/Dubai of the starter settings sit in.
export function addPlaces(storage, offered, deps) {
  // One bullet per name ("dublin", "cork"), so the Notion page stays readable instead of showing one long /regex/.
  const parts = (Array.isArray(offered) ? offered : []).filter(item => item && typeof item.fragment === 'string' && item.fragment.length <= 600
    && !/[^\w\\|.\s\u00c0-\u017f\[\]-]/.test(item.fragment))
    .flatMap(item => item.fragment.split('|').filter(Boolean).map(fragment => [fragment.toLowerCase(), {label: String(item.place || fragment), fragment}]));
  const wanted = [...new Map(parts).values()].slice(0, 60);
  const list = search => search.locations?.abroad || [];
  return widen(storage, wanted, list,
    (search, entries) => ({...search, locations: {...search.locations, abroad: [...list(search), ...entries]}}), deps);
}

// The shared shape of both: sync the page, change the cached file, publish the page, check the change survived (a search can put the old file back).
async function widen(storage, wanted, list, change, {run, ensurePage, writePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (!wanted.length) return {added: []};
  // A search (Focus refresh, the daily run) syncs the page into the cache first; right after our write Notion can still list the old blocks, so
  // that sync puts the old settings back. The page is right a moment later: read it again and redo the change, a few times, before giving up.
  let lost = [], first = null;
  for (let attempt = 0; attempt < ADD_ROLES_ATTEMPTS; attempt++) {
    if (attempt) await wait(2000 * attempt);
    await run(storage, ['src.notion.search_settings', 'sync']);
    const search = JSON.parse(storage.readText('config/search.json') || '{}');
    const have = new Set(list(search).map(entry => String(entry).toLowerCase()));
    const added = wanted.filter(item => !have.has(item.fragment.toLowerCase()));
    if (!added.length) return {added: first || []};
    first ||= [...new Set(added.map(item => item.label))];
    await saveSettings(storage, {search: change(search, added.map(item => item.fragment))}, {run, ensurePage, writePage});   // Notion first; refused: nothing changed
    // A search that pulled the page just before our write (or Notion listing the old blocks a moment longer) can put the old copy back over the new one,
    // and the call would still say it worked (seen in the strategy e2e suite). Check, and try again.
    const kept = new Set(list(JSON.parse(storage.readText('config/search.json') || '{}')).map(entry => String(entry).toLowerCase()));
    lost = [...new Set(added.filter(item => !kept.has(item.fragment.toLowerCase())).map(item => item.label))];
    if (!lost.length) return {added: first};
  }
  throw new Error(`A search changed your settings while they were being saved (${lost.join(', ')} did not stay). Try again.`);
}
export const ADD_ROLES_ATTEMPTS = 3;

// The other way to more jobs (owner, 6 Oct 2026: "his strategy may be what stops the app finding jobs"): drop an excluded title word or a
// language that rules jobs out, after the app said how many jobs it costs (src/coverage.py). Same care as widen: the page is read first,
// both settings are saved (saveSettings: Notion first, then the copy), the change is checked; Notion refusing changes neither.
export async function loosen(storage, {excludes = [], languages = []}, {run, ensurePage, writePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const lower = list => new Set(list.map(item => String(item).toLowerCase()));
  const dropWords = lower(excludes), dropLanguages = lower(languages);
  if (!dropWords.size && !dropLanguages.size) return {removed: []};
  for (let attempt = 0; attempt < ADD_ROLES_ATTEMPTS; attempt++) {
    if (attempt) await wait(2000 * attempt);
    await run(storage, ['src.notion.search_settings', 'sync']);
    const search = JSON.parse(storage.readText('config/search.json') || '{}'), prefs = JSON.parse(storage.readText('config/preferences.json') || '{}');
    const words = search.title_exclude_keywords || [], spoken = prefs.disqualifying_languages || [];
    const removed = [...words.filter(word => dropWords.has(String(word).toLowerCase())), ...spoken.filter(language => dropLanguages.has(String(language).toLowerCase()))];
    if (!removed.length) return {removed: []};
    await saveSettings(storage, {search: {...search, title_exclude_keywords: words.filter(word => !dropWords.has(String(word).toLowerCase()))},
      preferences: {...prefs, disqualifying_languages: spoken.filter(language => !dropLanguages.has(String(language).toLowerCase()))}}, {run, ensurePage, writePage});
    const still = [...(JSON.parse(storage.readText('config/search.json') || '{}').title_exclude_keywords || []), ...(JSON.parse(storage.readText('config/preferences.json') || '{}').disqualifying_languages || [])]
      .filter(item => dropWords.has(String(item).toLowerCase()) || dropLanguages.has(String(item).toLowerCase()));
    if (!still.length) return {removed};
  }
  throw new Error('A search changed your settings while they were being saved. Try again.');
}

// Tune my strategy: the changes the engine proposed from the user's outcomes (src/tune.py) and the user ticked. The caller
// passes proposals the engine produced again just now, never the window's copy, so only an offered change is ever written.
// Same loop as widen(): sync the page, save the change (Notion first), check the change stayed.
export function tuned(search, chosen) {
  const has = (list, fragment) => list.some(entry => String(entry).toLowerCase() === fragment.toLowerCase());
  return chosen.every(item => item.kind === 'exclude_title' ? has(search.title_exclude_keywords || [], item.fragment)
    : item.kind === 'drop_role' ? !hasFragment(search, item.fragment) : !has(search.locations?.[item.list] || [], item.fragment));
}
export function applyTune(search, chosen) {
  const next = {...search, locations: {...search.locations}};
  const without = (list, fragment) => (list || []).filter(entry => String(entry).toLowerCase() !== fragment.toLowerCase());
  for (const item of chosen) {
    if (item.kind === 'drop_role') Object.assign(next, dropFragment(next, item.fragment));
    else if (item.kind === 'drop_place' && ['top_tier', 'country_wide', 'abroad'].includes(item.list)) next.locations[item.list] = without(next.locations[item.list], item.fragment);
    else if (item.kind === 'exclude_title' && !tuned(next, [item])) next.title_exclude_keywords = [...(next.title_exclude_keywords || []), item.fragment];
  }
  return next;
}
// The guard behind Tune's Apply: the window sends ids only; the changes written are those of a fresh engine answer that match.
export const chooseOffered = (fresh, ids) => {
  const wanted = new Set(Array.isArray(ids) ? ids.map(String) : []);
  return {chosen: (fresh || []).filter(item => wanted.has(item.id)), asked: wanted.size};
};
export async function retune(storage, chosen, {run, ensurePage, writePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (!chosen.length) return {changed: []};
  for (let attempt = 0; attempt < ADD_ROLES_ATTEMPTS; attempt++) {
    if (attempt) await wait(2000 * attempt);
    await run(storage, ['src.notion.search_settings', 'sync']);
    const search = JSON.parse(storage.readText('config/search.json') || '{}');
    if (tuned(search, chosen)) return {changed: chosen.map(item => item.label)};
    await saveSettings(storage, {search: applyTune(search, chosen)}, {run, ensurePage, writePage});
    if (tuned(JSON.parse(storage.readText('config/search.json') || '{}'), chosen)) return {changed: chosen.map(item => item.label)};
  }
  throw new Error('A search changed your settings while they were being saved. Try again.');
}

/** The search and preference files as they will be once these accepted parts are saved, computed and written nowhere: {search, preferences}, null = that file is not touched. */
export function settingsAfter(storage, accepted) {
  const out = {search: null, preferences: null};
  // The Profile, standard answers and contact details go to Notion (main.js saveStrategy); here only the
  // search settings' cache is computed (published to ⚙️ Search settings with it, saveSettings).
  // A rebuild review may accept only some parts: a part left out (search or preferences) is not touched.
  if (accepted.search) {
    const current = JSON.parse(storage.readText('config/search.json') || '{}');
    const google = {...(current.google_jobs || {}), ...accepted.search.google_jobs,
      searches_per_run: current.google_jobs?.searches_per_run ?? 1, min_searches_left: current.google_jobs?.min_searches_left ?? 20};
    const kept = remoteWordOf(accepted.search.remote_jobs) || !current.remote_jobs?.length ? {} : {remote_jobs: current.remote_jobs};   // Why (retro review of #3687, owner 11 Nov 2026, "Show 'Yes → Country'"): the draft's Remote jobs is a listed line of the review (lib/strategy-rebuild.js remoteChange), so accepting Search criteria takes it; only a draft that said nothing keeps the person's word
    out.search = withoutNotes(withDerived({...current, ...accepted.search, ...kept, google_jobs: google}));   // the one list of roles gives role_keywords and the searches   // a note is never a setting (lib/config-text.js)
  }
  if (accepted.preferences) {
    const preferences = JSON.parse(storage.readText('config/preferences.json') || '{}');
    out.preferences = withoutNotes({...preferences, ...accepted.preferences});
  }
  return out;
}
/** Writes accepted parts to this Mac's files only: the store without Notion (keepLocally) and the demo seeds. A Notion store goes through saveSettings. */
export function save(storage, accepted) {
  const after = settingsAfter(storage, accepted);
  for (const [name, content] of Object.entries(after)) if (content) storage.writeText(SETTINGS_FILES[name], JSON.stringify(content, null, 2) + '\n');
}
