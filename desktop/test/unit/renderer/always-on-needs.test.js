// Guard: money + security — a person on Free AI must be asked for their own key before Always on on GitHub is turned on, because Free AI's key is never copied there (owner, 3 Nov 2026).
// Run: node --test test/unit/renderer/always-on-needs.test.js
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {alwaysOnNeeds, requirementRows} from '../../../renderer/always-on-needs.js';

const CLAUDE = {name: 'ANTHROPIC_API_KEY', provider: 'Anthropic', cli: 'Claude Code'}, OPENAI = {name: 'OPENAI_API_KEY', provider: 'OpenAI', cli: 'Codex'};
const ids = needs => needs.map(need => need.id);

test('Free AI is not a key: the slot is filled but the person is asked for their own, with the way out to our servers', () => {
  const needs = alwaysOnNeeds({secrets: {NOTION_TOKEN: true, ANTHROPIC_API_KEY: true}, ownSecrets: {NOTION_TOKEN: true, ANTHROPIC_API_KEY: false}}, CLAUDE);
  assert.deepEqual(ids(needs), ['ai']);
  assert.match(needs[0].why, /cannot use Free AI/);
  assert.match(needs[0].why, /our servers instead: no key needed/);
  assert.deepEqual(needs[0].alt, {setting: 'hosted', button: 'Use our servers →'});
});

test('an own key and Notion: nothing is missing', () => {
  assert.deepEqual(alwaysOnNeeds({secrets: {NOTION_TOKEN: true, ANTHROPIC_API_KEY: true}, ownSecrets: {NOTION_TOKEN: true, ANTHROPIC_API_KEY: true}}, CLAUDE), []);
});

test('a subscription (no key at all) is asked too, with its own words; a window state without ownSecrets still works', () => {
  const needs = alwaysOnNeeds({secrets: {NOTION_TOKEN: true}}, CLAUDE);
  assert.deepEqual(ids(needs), ['ai']);
  assert.match(needs[0].why, /cannot use Claude Code/);
});

test('the chosen family decides the key: OpenAI asks for an OpenAI key even when an Anthropic one is saved', () => {
  const needs = alwaysOnNeeds({secrets: {NOTION_TOKEN: true, ANTHROPIC_API_KEY: true}, ownSecrets: {NOTION_TOKEN: true, ANTHROPIC_API_KEY: true}}, OPENAI);
  assert.equal(needs[0].title, 'Add an OpenAI API key');
});

test('Notion comes first when both are missing', () => assert.deepEqual(ids(alwaysOnNeeds({secrets: {}}, CLAUDE)), ['notion', 'ai']));

// Why (4 Nov 2026, owner: "Notion should not be inside Github. They should be siblings. Both of them are needed"): Notion and the API key are rows of their own next to GitHub's, each with its own state.
test('the own way shows Notion and the API key as sibling rows, and counts GitHub as the third requirement', () => {
  const mixed = requirementRows({secrets: {ANTHROPIC_API_KEY: true}, ownSecrets: {ANTHROPIC_API_KEY: true}}, CLAUDE);
  assert.deepEqual(mixed.rows.map(row => [row.id, row.pill[0]]), [['notion', 'Needed'], ['ai', 'Added']]);
  assert.equal(mixed.rows[0].button, 'Connect Notion →');
  assert.equal(mixed.rows[1].button, undefined);
  assert.match(mixed.rows[0].line, /saves every job it finds/);
  assert.match(mixed.rows[1].line, /Pays for the AI that reads and scores/);
  assert.equal(mixed.done, 1);
  const ready = requirementRows({secrets: {NOTION_TOKEN: true, ANTHROPIC_API_KEY: true}, ownSecrets: {NOTION_TOKEN: true, ANTHROPIC_API_KEY: true}}, CLAUDE, {githubOn: true});
  assert.deepEqual(ready.rows.map(row => row.pill[0]), ['Connected', 'Added']);
  assert.equal(ready.done, 3);
  assert.equal(requirementRows({secrets: {}, ownSecrets: {}}, CLAUDE).done, 0);
});
