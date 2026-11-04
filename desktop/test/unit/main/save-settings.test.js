// saveSettings (lib/strategy-settings.js): the settings page is written first, then this Mac's copy (owner, 3 Nov 2026: "Notion first, then here"); a Mac store writes the copy only.
// The race itself, against the real engine and the Notion stand-in: integration/store/strategy-notion-integration.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {saveSettings} from '../../../lib/strategy.js';

function setup({notion = true, writeFails = false, renderFails = false} = {}) {
  const files = {'config/search.json': '{"role_keywords":["sre"]}', 'config/preferences.json': '{"digest_min_score":50}'};
  const calls = [], given = [];
  const storage = {readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; calls.push(`write:${name}`); }, path: (...parts) => parts.join('/'),
    secret: name => (name === 'NOTION_TOKEN' && notion ? 'tok' : ''), saveSettings() {},
    settings: () => ({store: notion ? 'notion' : 'sqlite', setupDone: true, notionIds: notion ? {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_SEARCH_SETTINGS_PAGE: 'settings'} : {}})};
  const deps = {
    run: async (_, args) => {
      calls.push(`run:${args[1]}`);
      const file = args[args.indexOf('--from') + 1];
      given.push({file, content: JSON.parse(fs.readFileSync(file, 'utf8')), mode: fs.statSync(path.dirname(file)).mode & 0o777});
      return renderFails ? {code: 1, stdout: ''} : {code: 0, stdout: '## Target roles\n- sre\n'};
    },
    ensurePage: async () => 'settings',
    writePage: async () => { calls.push('page'); if (writeFails) throw new Error('Notion said no'); }};
  return {files, calls, given, storage, deps};
}

test('Notion first: the page is rendered from the new settings (the other file as it is now), written, and only then the copy', async () => {
  const t = setup();
  await saveSettings(t.storage, {search: {role_keywords: ['sre', 'devops']}}, t.deps);
  assert.deepEqual(t.calls, ['run:render', 'page', 'write:config/search.json']);
  assert.deepEqual(t.given[0].content, {search: {role_keywords: ['sre', 'devops']}, preferences: {digest_min_score: 50}});
  assert.equal(t.files['config/preferences.json'], '{"digest_min_score":50}', 'a file not given is left alone');
  assert.deepEqual(JSON.parse(t.files['config/search.json']).role_keywords, ['sre', 'devops']);
  assert.ok(!fs.existsSync(path.dirname(t.given[0].file)), 'the folder the settings went to the engine in was not removed');
  if (process.platform !== 'win32') assert.equal(t.given[0].mode, 0o700, 'the folder the engine reads the settings from is open to others');
});

test('a refused page write writes nothing here and says so (copyUnchanged)', async () => {
  const t = setup({writeFails: true});
  const before = {...t.files};
  await assert.rejects(saveSettings(t.storage, {search: {role_keywords: ['x']}, preferences: {digest_min_score: 70}}, t.deps), error => error.copyUnchanged === true && /Notion said no/.test(error.message));
  assert.deepEqual(t.files, before);
  assert.ok(!t.calls.some(call => call.startsWith('write:')));
});

test('a page that cannot be rendered writes nothing anywhere', async () => {
  const t = setup({renderFails: true});
  await assert.rejects(saveSettings(t.storage, {search: {role_keywords: ['x']}}, t.deps), error => error.copyUnchanged === true && /Could not render/.test(error.message));
  assert.deepEqual(t.calls, ['run:render']);
  assert.ok(!fs.existsSync(path.dirname(t.given[0].file)), 'the settings folder was left behind');
});

test('this Mac\'s store has no page: the copy is written and nothing else runs', async () => {
  const t = setup({notion: false});
  await saveSettings(t.storage, {preferences: {digest_min_score: 80}}, t.deps);
  assert.deepEqual(t.calls, ['write:config/preferences.json']);
});

test('a corrupt settings file stops the save: the page is never rendered without the file\'s sections', async () => {
  const t = setup();
  t.files['config/search.json'] = '{"role_keywords": ["sre"';   // truncated
  await assert.rejects(saveSettings(t.storage, {preferences: {daily_applications_target: 9}}, t.deps), SyntaxError);
  assert.deepEqual(t.calls, [], 'something ran although a settings file could not be read');
});
