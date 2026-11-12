// Strategy, rebuild from the CV: what a new draft changes, grouped by what each change triggers (and its cost). Re-exported by strategy.js.
// Guarded by desktop/test/unit/main/strategy-rebuild.test.js.
// ---------- Rebuild from CV: what a new draft changes, grouped by what each change triggers ----------
// Search criteria and filters change what the crawl keeps and hides; the Profile's scoring part changes every fit
// score (the scored jobs become old scores; Re-score updates them, AI cost); standard answers only change future kits and forms. Locations
// and remote rules live in both the search settings (crawl) and the Profile (score): a change to them links the two
// groups, so they're applied together and can't disagree.
import {settingsText as words} from '../i18n/settings-native.js';
import {rememberDisplay, displayNote, concatDisplay} from './settings-native-display.js';
export const SCORE_USD = 0.015;       // one Sonnet 5 fit score, measured on the owner's runs (about 1.2 to 1.8 cents)
export const SCORES_PER_SEARCH = 60;  // the app's --score-max
const FORM_ONLY = /contact|\blinks?\b|application form answers|📎/i;
import {fragmentWords} from '../renderer/fragment-words.js';
import {titlesOf} from './target-roles.js';
import {remoteWordOf} from '../renderer/remote-word.js';
export const wordsOf = fragmentWords;   // a crawl pattern as words (one rule for every screen)
function sections(markdown, skipFormOnly = false) {
  const found = new Map();
  let name = '', skipping = false;
  for (const line of String(markdown || '').split('\n')) {
    const heading = line.match(/^\s*#+\s+(.*)/);
    if (heading) { name = heading[1].trim(); skipping = skipFormOnly && FORM_ONLY.test(name); if (!skipping) found.set(name, []); continue; }
    if (!skipping && line.trim()) (found.get(name) || found.set(name, []).get(name)).push(line.trim());
  }
  return found;
}
const SECTION_NAMES = new Map([
  ["Summary", ["fieldSummary", ""]],
  ["Availability", ["fieldAvailability", ""]],
  ["Targets", ["fieldTargets", ""]],
  ["Strengths", ["fieldStrengths", ""]],
  ["Education", ["fieldEducation", ""]],
  ["Experience", ["fieldExperience", ""]],
  ["Deal-breakers", ["fieldDealBreakers", ""]],
  ["Hard constraints", ["fieldHardConstraints", ""]],
  ["Compensation", ["fieldCompensation", ""]],
  ["Preferences (soft, used for ranking)", ["fieldPreferences", ""]],
  ["Core skills", ["fieldCoreSkills", ""]],
  ["Work eligibility", ["fieldWorkEligibility", ""]],
  ["Availability & compensation", ["fieldAvailabilityCompensation", ""]],
  ["Languages", ["fieldLanguages", ""]],
  ["Common questions", ["fieldCommonQuestions", ""]],
  ["Cover letter style", ["fieldCoverLetterStyle", ""]],
  ["Availability and pay", ["fieldAvailabilityPay", ""]],
  ["Eligibility", ["fieldEligibility", ""]],
  ["Form-filling time", ["fieldFormTime", ""]],
  ["Possible CV gaps", ["fieldCvGaps", ""]],
  ["Summary (from CV)", ["fieldCvSummary", ""]],
  ["Standard answers", ["fieldStandardAnswers", ""]],
  ["🛂 Work eligibility", ["fieldWorkEligibility", "🛂 "]],
  ["💶 Availability & compensation", ["fieldAvailabilityCompensation", "💶 "]],
  ["🗣️ Languages", ["fieldLanguages", "🗣️ "]],
  ["❓ Possible CV gaps", ["fieldCvGaps", "❓ "]],
]);
// Why (7 Nov 2026, owner): known template field names translate only in rebuild display; canonical Markdown and unrecognized headings stay raw.
function sectionName(name) {
  if (!name) return words('sectionIntro');
  const known = SECTION_NAMES.get(name);
  return known ? known[1] + words(known[0]) : name;
}
function sectionChanges(before, after, skipFormOnly) {
  const old = sections(before, skipFormOnly), next = sections(after, skipFormOnly);
  const changes = [];
  for (const [name, lines] of next) {
    if (!old.has(name)) displayNote(changes, `+ ${name || 'Intro'} (new section)`, () => words('sectionNew', {name: sectionName(name)}));
    else if (old.get(name).join('\n') !== lines.join('\n')) displayNote(changes, `~ ${name || 'Intro'}`, () => words('sectionChanged', {name: sectionName(name)}));
  }
  for (const name of old.keys()) if (!next.has(name)) displayNote(changes, `− ${name || 'Intro'} (removed)`, () => words('sectionRemoved', {name: sectionName(name)}));
  return changes;
}
function listChanges(label, before = [], after = [], displayKey) {
  const old = new Set(before.map(wordsOf)), next = new Set(after.map(wordsOf));
  const added = [...next].filter(item => item && !old.has(item)), removed = [...old].filter(item => item && !next.has(item));
  const changes = [], values = [...added.map(item => `+${item}`), ...removed.map(item => `−${item}`)].join(', ');
  if (added.length || removed.length) displayNote(changes, `${label}: ${values}`, () => words('changeList', {label: words(displayKey), values}));
  return changes;
}
const REMOTE_WORDS = {yes: 'remoteYes', no: 'remoteNo', country: 'remoteCountry'};
/** "Remote work: Yes → My country": the draft's Remote jobs against the saved one, one line of Search criteria (retro review of #3687, owner 11 Nov 2026), so ticking the group is the person's yes. */
function remoteChange(before, after) {
  const from = remoteWordOf(before, 'yes'), to = remoteWordOf(after);
  const changes = [];
  if (to && to !== from) displayNote(changes, `Remote work: ${from} → ${to}`, () => words('changeRemote', {label: words('labelRemoteWork'), from: words(REMOTE_WORDS[from]), to: words(REMOTE_WORDS[to])}));
  return changes;
}
export function rebuildGroups({search = {}, preferences = {}, profile = '', answers = ''}, draft, {scored = 0, kits = 0} = {}) {
  const next = draft.search || {}, places = search.locations || {}, nextPlaces = next.locations || {};
  const where = concatDisplay(listChanges('Top cities', places.top_tier, nextPlaces.top_tier, 'labelCities'), listChanges('Country', places.country_wide, nextPlaces.country_wide, 'labelCountry'),
    listChanges('Abroad', places.abroad, nextPlaces.abroad, 'labelAbroad'), listChanges('Remote excluded for', search.remote_excluded_regions, next.remote_excluded_regions, 'labelRemoteExcluded'));
  const searchChanges = concatDisplay(listChanges('Target roles', titlesOf(search), titlesOf(next), 'labelRoles'), listChanges('Level', search.level, next.level, 'labelLevel'),
    where, remoteChange(search.remote_jobs, next.remote_jobs),
    listChanges('Excluded titles', search.title_exclude_keywords, next.title_exclude_keywords, 'labelExcludedTitles'),
    listChanges('Key skills and tools', search.quality_stack_keywords, next.quality_stack_keywords, 'labelSkills'));
  const prefs = draft.preferences || {};
  const filterChanges = concatDisplay(listChanges('Languages you don\'t work in', preferences.disqualifying_languages, prefs.disqualifying_languages, 'labelLanguages'),
    listChanges('Excluded companies', preferences.excluded_companies, prefs.excluded_companies, 'labelCompanies'));
  const profileChanges = sectionChanges(profile, draft.profile_markdown, true);
  const answerChanges = sectionChanges(answers, draft.answers_markdown, false);
  const linked = where.length > 0 && profileChanges.length > 0;
  return [
    {id: 'search', title: 'Search criteria', changes: searchChanges, linked: linked ? 'profile' : null,
      impact: 'The next search crawls and ranks with them. Jobs found before stay until they are unseen for 7 days.', cost: 'No AI cost'},
    {id: 'filters', title: 'Filters', changes: filterChanges, impact: 'Matching jobs are hidden at once.', cost: 'No AI cost'},
    {id: 'profile', title: 'Profile (what the fit score reads)', changes: profileChanges, linked: linked ? 'search' : null,
      impact: `Marks ${scored} scored job${scored === 1 ? '' : 's'} as old scores; Re-score updates them, up to 60 at a time` +
        (kits ? `; ${kits} unsent application${kits === 1 ? '' : 's'} were prepared with the old Profile (prepare again the ones you still want)` : '') + '.',
      cost: scored ? 'Uses AI' : 'No AI cost'},
    {id: 'answers', title: 'Standard answers', changes: answerChanges, impact: 'Used by the next applications and form fills. Nothing is re-scored.', cost: 'No AI cost'},
  ].filter(group => group.changes.length).map(group => rememberDisplay(group, {
    title: () => words(`group${group.id}`),
    impact: () => group.id === 'profile'
      ? words('impactProfile', {count: scored}) + (kits ? words('impactKits', {count: kits}) : '') + '.'
      : words(`impact${group.id}`),
  }));
}
