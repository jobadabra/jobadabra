// The draft says how far the person would go (lj 2/4, owner 10 Nov 2026, "A: How far would you go?" + "Only under 'Any remote'"): it can set "Remote jobs"
// and leave country_wide empty for work that needs them in one place; the prompt says when (drafted by the AI, validated here as schema + wording).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DRAFT_SCHEMA, INSTRUCTIONS, applyEdits, cleanEdits, edited, settingsAfter} from '../../../lib/strategy.js';

test('the draft schema carries remote_jobs next to the locations, as a list of words', () => {
  const search = DRAFT_SCHEMA.properties.search.properties;
  assert.deepEqual(search.remote_jobs, {type: 'array', items: {type: 'string'}});
  assert.ok(DRAFT_SCHEMA.properties.search.required.includes('remote_jobs'), 'every draft answers it');
});

test('the prompt no longer fills the whole country for every role, and names the three Remote jobs words', () => {
  assert.ok(!/country_wide the rest of that country,/.test(INSTRUCTIONS), 'the old sentence filled the whole country for every draft (16 of 18 on 10 Nov 2026)');
  assert.match(INSTRUCTIONS, /country_wide the rest of that country ONLY when their work can be done anywhere in it/);
  assert.match(INSTRUCTIONS, /leave it \[\] for work that needs them in one place/);
  for (const word of ['["No"]', '["Country"]', '["Yes"]']) assert.ok(INSTRUCTIONS.includes(word), word);
});

// Code review of lj 2/4: a rebuild's draft always carries Remote jobs, so the person's own choice must survive it (its review lists no such change).
const storageOf = search => ({readText: name => (name === 'config/search.json' ? JSON.stringify(search) : '{}')});

test('a rebuild keeps the Remote jobs the person chose, and a first setup takes the draft\'s', () => {
  const chosen = settingsAfter(storageOf({role_keywords: ['nurse'], remote_jobs: ['Yes']}), {search: {target_roles: ['nurse'], remote_jobs: ['No']}});
  assert.deepEqual(chosen.search.remote_jobs, ['Yes'], 'the draft said No, the person had Yes: unchanged, silently overwriting it hid all their remote jobs');
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
