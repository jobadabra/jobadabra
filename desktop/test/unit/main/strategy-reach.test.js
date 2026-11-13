// The draft says how far the person would go (lj 2/4, owner 10 Nov 2026, "A: How far would you go?" + "Only under 'Any remote'"): it can set "Remote jobs"
// and leave country_wide empty for work that needs them in one place; the prompt says when (drafted by the AI, validated here as schema + wording).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DRAFT_SCHEMA, INSTRUCTIONS, applyEdits, cleanEdits, edited, rebuildGroups, settingsAfter} from '../../../lib/strategy.js';
import {forWindow} from '../../../lib/settings-native-display.js';

test('the draft schema carries remote_jobs next to the locations, as a list of words', () => {
  const search = DRAFT_SCHEMA.properties.search.properties;
  assert.deepEqual(search.remote_jobs, {type: 'array', items: {type: 'string', enum: ['No', 'Country', 'Yes']}}, 'the three words only: a country\'s name reads as Yes in the engine (#3792)');
  assert.ok(DRAFT_SCHEMA.properties.search.required.includes('remote_jobs'), 'every draft answers it');
});

test('the prompt no longer fills the whole country for every role, and names the three Remote jobs words', () => {
  assert.ok(!/country_wide the rest of that country,/.test(INSTRUCTIONS), 'the old sentence filled the whole country for every draft (16 of 18 on 10 Nov 2026)');
  for (const word of ['["No"]', '["Country"]', '["Yes"]']) assert.ok(INSTRUCTIONS.includes(word), word);
});

// rj 1/2 (#3792; night 42927975750, 11 Nov 2026): after #3687 the draft still gave the whole country to an HR generalist in Cluj, a software engineer in Amsterdam,
// a data analyst in Lisbon (Claude, by hand, same day) and a welder in Leipzig (Codex): the goals line still said "then the rest of that country", and the search rule let
// "office" roles have it, though an office in another city is a move. The country alone is the person's own choice (Settings → Locations, Notion) or the CV's or note's words.
test('the draft leaves the rest of the country out unless the CV or note says they would work anywhere in it; remote in the country is Remote jobs "Country"', () => {
  assert.ok(!/then the rest of that country/.test(INSTRUCTIONS), 'the goals line proposed the whole country for every person');
  assert.ok(!/office, remote-friendly or nationwide roles/.test(INSTRUCTIONS), 'an office job in another city is not one they can take without moving');
  assert.match(INSTRUCTIONS, /country_wide stays \[\] unless the CV or note says they would work anywhere in that country/);
  assert.match(INSTRUCTIONS, /remote work in their country is remote_jobs \["Country"\] \(that word itself, never the country's name\), never country_wide/);
});

// Retro review of #3687 (Gitar, 10 Nov 2026; owner 11 Nov 2026, asked via AskUserQuestion: "Show 'Yes → Country' (Recommended)"): a rebuild's draft always carries Remote jobs, and keeping the saved value
// silently meant a person on an older "Yes" never got the draft's Country. The review now lists the change as a line of Search criteria; ticking that group saves it, leaving it unticked keeps the person's.
const storageOf = search => ({readText: name => (name === 'config/search.json' ? JSON.stringify(search) : '{}')});

test('the draft no longer asks where the person may work: work rights live only in the Profile (#3850)', () => {
  assert.ok(!('work_rights' in DRAFT_SCHEMA.properties.preferences.properties), 'owner, 12 Nov 2026: "They should be only in the Profile"');
  assert.ok(!/work_rights/.test(INSTRUCTIONS));
});

test('a rebuild lists "Remote work: Yes → My country" in Search criteria; an older strategy with no word counts as Yes; nothing is listed when the word is the same', () => {
  const lines = (current, draft) => rebuildGroups({search: current}, {search: draft}).find(group => group.id === 'search')?.changes || [];
  assert.ok(forWindow(lines({remote_jobs: ['Yes']}, {remote_jobs: ['Country']})).includes('Remote work: Yes → My country'));
  assert.ok(forWindow(lines({}, {remote_jobs: ['Country']})).includes('Remote work: Yes → My country'), 'missing = Yes (an old strategy)');
  assert.ok(forWindow(lines({remote_jobs: ['No']}, {remote_jobs: ['Yes']})).includes('Remote work: No → Yes'));
  assert.deepEqual(lines({remote_jobs: ['Country']}, {remote_jobs: ['Country']}).filter(line => /Remote work/.test(line)), []);
  // Code review: the engine reads none/never/off/false/non/nein as No (src/sources/feeds.py remote_wanted); one reader, renderer/remote-word.js, serves this review and the Strategy cards.
  assert.ok(forWindow(lines({remote_jobs: ['none']}, {remote_jobs: ['Country']})).includes('Remote work: No → My country'), 'a saved "none" is No, as the engine reads it');
  assert.doesNotThrow(() => lines({remote_jobs: 'No'}, {remote_jobs: ['Country']}), 'a saved value that is not a list does not break the review');
  assert.ok(forWindow(lines({remote_jobs: 'No'}, {remote_jobs: ['Country']})).includes('Remote work: Yes → My country'), 'the engine iterates a bare string by letters and finds no word: Yes (src/sources/feeds.py remote_wanted)');
  assert.deepEqual(lines({remote_jobs: ['No']}, {remote_jobs: ['None']}).filter(line => /Remote work/.test(line)), [], 'the same word in another spelling is no change');
  assert.deepEqual(lines({remote_jobs: ['Yes']}, {remote_jobs: []}).filter(line => /Remote work/.test(line)), [], 'a draft that says nothing changes nothing');
});

test('a rebuild takes the draft\'s Remote jobs when Search criteria is accepted (the person saw the line), keeps theirs when the draft says none, and a first setup takes the draft\'s', () => {
  const accepted = settingsAfter(storageOf({role_keywords: ['nurse'], remote_jobs: ['Yes']}), {search: {target_roles: ['nurse'], remote_jobs: ['Country']}});
  assert.deepEqual(accepted.search.remote_jobs, ['Country']);
  const silent = settingsAfter(storageOf({role_keywords: ['nurse'], remote_jobs: ['No']}), {search: {target_roles: ['nurse'], remote_jobs: []}});
  assert.deepEqual(silent.search.remote_jobs, ['No'], 'an empty answer never wipes the person\'s word');
  const same = settingsAfter(storageOf({role_keywords: ['nurse'], remote_jobs: ['none']}), {search: {target_roles: ['nurse'], remote_jobs: ['']}});
  assert.deepEqual(same.search.remote_jobs, ['none'], 'a draft word that is no word keeps theirs');
  const first = settingsAfter(storageOf({role_keywords: []}), {search: {target_roles: ['nurse'], remote_jobs: ['Country']}});
  assert.deepEqual(first.search.remote_jobs, ['Country'], 'nothing chosen yet: the draft decides');
});

// lj 3/4 (owner 10 Nov 2026: "Small: add a third Remote work button"): the page's Remote work edit may say Country, nothing else new.
test('a Remote work edit may say Yes, No or Country, and is written and read back as such', () => {
  for (const set of ['Yes', 'No', 'Country']) assert.deepEqual(cleanEdits({remote: {set}}), {remote: {set}}, set);
  assert.deepEqual(cleanEdits({remote: {set: 'Worldwide'}}), {}, 'an unknown word is dropped');
  const files = {search: {remote_jobs: ['No'], locations: {top_tier: ['dublin']}}, preferences: {}};
  const next = applyEdits(files, {remote: {set: 'Country'}});
  assert.deepEqual(next.search.remote_jobs, ['Country']);
  assert.ok(edited(next, {remote: {set: 'Country'}}));
  assert.ok(!edited(files, {remote: {set: 'Country'}}));
});

// pp (#3953 follow-up; benchmark run 43328194035, p10 Lisbon): the draft wrote places ["lisb(on|oa)"] because this prompt called locations "regex fragments";
// the engine read no place, no country and no board web search. A place is a plain name; two spellings are two entries. The engine still reads a saved
// pattern through src/places.py spellings (the floor under this rule).
test('the draft writes each place as one plain name, two spellings as two entries, never a pattern', () => {
  assert.ok(!/locations and remote_excluded_regions are case-insensitive regex fragments/.test(INSTRUCTIONS), 'locations are no longer listed among the regex fragments');
  assert.match(INSTRUCTIONS, /Each entry of locations is one plain place name as job postings write it/);
  assert.match(INSTRUCTIONS, /never a pattern: no \|, brackets, parentheses or other regex signs; a place with two spellings is two entries \("lisboa", "lisbon"/);
});
