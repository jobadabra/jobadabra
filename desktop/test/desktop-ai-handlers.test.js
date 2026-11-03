// What the desktop AI's read tools read from the running app (lib/desktop-ai-handlers.js): the window's registry, the saved Jobs and Strategy, the Profile and the support report. Never a fresh AI or Notion read.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {desktopAiSources, windowScreen, registerDesktopAi} from '../lib/desktop-ai-handlers.js';
import {setDesktopAiSources} from '../lib/desktop-ai-server.js';
import {callTool} from '../lib/desktop-ai-tools.js';
import {fakeStorage} from './desktop-ai-fake-storage.js';

const fakeWindow = (answer, seen = []) => ({isDestroyed: () => false, webContents: {executeJavaScript: async code => { seen.push(code); return typeof answer === 'function' ? answer(code) : answer; }}});
const app = {getVersion: () => '1.2.3', getLocale: () => 'en', getPath: () => '/tmp/none'};

test('windowScreen asks the registry with the key as JSON, never as code', async () => {
  const seen = [];
  await windowScreen(fakeWindow({screen: 'jobs'}, seen), 'jobs"); require("fs"); ("');
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^window\.jobadabraScreenData \? window\.jobadabraScreenData\("jobs\\"\); require\(\\"fs\\"\); \(\\""\) : null$/);
});

test('a closed window or a window that has not loaded says so instead of failing', async () => {
  assert.equal((await windowScreen(null, 'jobs')).source, 'none');
  assert.equal((await windowScreen({isDestroyed: () => true}, 'jobs')).source, 'none');
  assert.match((await windowScreen(fakeWindow(null), 'jobs')).note, /still loading/);
});

test('open questions come from the What we learned registry entry; when the page has not loaded they say what to open', async () => {
  const seen = [];
  const sources = desktopAiSources({app, storage: fakeStorage(), getWindow: () => fakeWindow({screen: 'profile:answers', source: 'registry', data: {questions: [{id: 'q1'}]}}, seen)});
  assert.deepEqual((await sources.questions()).data.questions, [{id: 'q1'}]);
  assert.match(seen[0], /"profile:answers"/);
  const empty = desktopAiSources({app, storage: fakeStorage(), getWindow: () => fakeWindow({screen: 'profile:answers', source: 'none', data: null})});
  assert.match((await empty.questions()).note, /Open Profile → What we learned/);
});

test('jobs and strategy are the last saved reads with their age; nothing saved says what to open; no fresh read is made', async () => {
  const jobs = {at: '2026-11-03T08:00:00Z', result: {jobs: [{code: 'J1', id: 'a', title: 'Nurse', company: 'Acme', fit: 82, status: 'new', description: 'x'.repeat(5000), posting: 'FULL POSTING TEXT'}]}};
  const sources = desktopAiSources({app, storage: fakeStorage(), getWindow: () => null, readView: name => ({jobs, strategy: {at: '2026-11-03T07:00:00Z', result: {level: 'senior'}}})[name] || null});
  const read = await sources.jobs();
  assert.equal(read.savedAt, jobs.at);
  assert.deepEqual(Object.keys(read.jobs[0]).sort(), ['code', 'company', 'fit', 'id', 'origin', 'status', 'title'], 'ids, title, company, fit, status; never a posting or a description');
  assert.ok(!JSON.stringify(read).includes('FULL POSTING TEXT'));
  assert.deepEqual((await sources.strategy()).strategy, {level: 'senior'});
  const none = desktopAiSources({app, storage: fakeStorage(), getWindow: () => null, readView: () => null});
  assert.match((await none.jobs()).note, /Open Jobs in the app/);
  assert.match((await none.strategy()).note, /Open Strategy/);
});

test('the Profile is the feedback snapshot text, and the whole chain through the tool list redacts it', async () => {
  const sources = desktopAiSources({app, storage: fakeStorage(), getWindow: () => null, profileOf: async () => ({parts: {details: {email: 'ana.fake@example.com', note: 'sk-abcdefghijklmnopqrstuvwx'}}, lacked: []})});
  const done = await callTool('get_profile', {}, sources);
  assert.equal(done.isError, false);
  assert.ok(done.text.includes('Snapshot of the Profile'));
  assert.ok(!done.text.includes('ana.fake@example.com') && !done.text.includes('sk-abcdef'));
});

test('demo mode registers no sources, so every tool is "not available"; a normal app registers them', async () => {
  registerDesktopAi({DEMO: true, app, storage: fakeStorage(), getWindow: () => null});
  const { handleRpc } = await import('../lib/desktop-ai-server.js');
  const demo = await handleRpc({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'get_jobs', arguments: {}}});
  assert.match(demo.result.content[0].text, /not available right now/);
  registerDesktopAi({DEMO: false, app, storage: fakeStorage(), getWindow: () => null, readView: () => null});
  const live = await handleRpc({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'get_jobs', arguments: {}}});
  assert.match(live.result.content[0].text, /Open Jobs in the app/);
  setDesktopAiSources(null);
});
