// The setup draft as the Strategy page's cards read it: the same shape src/desktop_strategy.py gives, built from the AI's draft.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {draftAsStrategy} from '../../../renderer/draft-strategy.js';

const draft = {
  search: {target_roles: [{title: 'Nurse', also: []}, 'Ward Nurse'], locations: {top_tier: ['\\bbrno\\b'], country_wide: ['czechia'], abroad: [], relocation: ['yes']}, level: ['junior'],
    remote_jobs: ['no'], quality_stack_keywords: ['icu'], google_jobs: {queries: ['nurse brno'], locations: [{location: 'Brno', language: 'cs'}]}},
  preferences: {work_rights: ['\\beu\\b'], disqualifying_languages: ['German'], excluded_companies: ['Acme'], digest_min_score: 60},
  goals: {seniority: 'Junior', work_mode: 'On-site', minimum_salary: '30,000 CZK/year (estimate)'},
};

test('lists carry the fragment and its words, roles the first five as searched', () => {
  const data = draftAsStrategy(draft);
  assert.deepEqual(data.lists.roles.map(role => role.label), ['Nurse', 'Ward Nurse']);
  assert.ok(data.lists.roles.every(role => role.searched));
  assert.deepEqual(data.lists.places, [{fragment: '\\bbrno\\b', label: 'brno'}]);
  assert.deepEqual(data.lists.rights.map(entry => entry.label), ['eu']);
  assert.deepEqual(data.texts, {languages: ['German'], skip: ['Acme'], gqueries: ['nurse brno'], gplaces: ['Brno · cs']});
});

test('values: relocation, remote, level, minimum score, goals', () => {
  const data = draftAsStrategy(draft);
  assert.equal(data.relocation, 'yes');
  assert.equal(data.remote_jobs, false);
  assert.equal(data.level, 'junior');
  assert.equal(data.digest_min_score, 60);
  assert.equal(data.goals.work_mode, 'On-site');
  assert.equal(data.compensation, '30,000 CZK/year (estimate)');
});

test('an empty draft reads as nothing set, never throws', () => {
  const data = draftAsStrategy({});
  assert.equal(data.relocation, 'unspecified');
  assert.equal(data.remote_jobs, true);
  assert.deepEqual(data.lists.roles, []);
});

test('the Remote jobs word reads as the engine reads it (src/my_places.py remote_word), mixed lists too', () => {
  // The same rows as tests/unit/sources/test_places_one_home.py WORDS (Gitar on #3814: the draft took the first word).
  const rows = [[['No'], 'no'], [['none'], 'no'], [['Nein'], 'no'], [['Country'], 'country'], [['Yes'], 'yes'], [[], 'yes'],
    [['yes', 'country'], 'country'], [['Country', 'None'], 'no']];
  for (const [said, word] of rows) assert.equal(draftAsStrategy({search: {remote_jobs: said}}).remote_word, word, JSON.stringify(said));
});
