// Connect with LinkedIn, app side (lib/linkedin-oauth.js, lib/experience-handlers.js, renderer/pages/experience.js): the state travels to the
// site, the profile comes back to this app's own socket once, a token is never kept, and the window offers connect, "use my name and email" and disconnect.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {cancel, connect, kept} from '../../../lib/linkedin-oauth.js';
import {receive} from '../../../lib/oauth-handoff.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const PROFILE = {ok: true, sub: 's1', name: 'Ada Example', given_name: 'Ada', family_name: 'Example', email: 'ada@example.test', locale: 'en'};

test('connect opens the start page with a state, waits for the site to hand the profile to this app, and returns it', async () => {
  let opened = '';
  const waiting = connect(url => { opened = url; }, {site: 'https://site.test'});
  await new Promise(r => setImmediate(r));
  assert.match(opened, /^https:\/\/site\.test\/api\/linkedin\/start\?state=[A-Za-z0-9_-]{43}$/);
  const state = new URL(opened).searchParams.get('state');
  assert.equal(receive('linkedin-signin', new URLSearchParams({state, sub: 's1', name: 'Ada Example', given_name: 'Ada', family_name: 'Example', email: 'ada@example.test', locale: 'en'})), true);
  assert.deepEqual(await waiting, {ok: true, sub: 's1', name: 'Ada Example', given_name: 'Ada', family_name: 'Example', email: 'ada@example.test', locale: 'en'});
});

test('no answer, cancelled, a browser that will not open, or a hand-off without a profile: a clear error', async () => {
  assert.match((await connect(() => {}, {timeout: 5, site: 'https://x'})).error, /5 minutes/);
  const waiting = connect(() => {}, {site: 'https://x'});
  await new Promise(r => setImmediate(r));
  cancel();
  assert.equal((await waiting).error, 'Cancelled.');
  assert.match((await connect(() => { throw new Error('no browser'); }, {site: 'https://x'})).error, /could not be opened/);
  let opened = '';
  const empty = connect(url => { opened = url; }, {site: 'https://x'});
  await new Promise(r => setImmediate(r));
  receive('linkedin-signin', new URLSearchParams({state: new URL(opened).searchParams.get('state'), name: 'No Sub'}));
  assert.match((await empty).error, /did not send your profile/);
});

test('the app keeps who it is, never a token or a picture', () => {
  const saved = kept(PROFILE, new Date('2026-10-10T12:00:00Z'));
  assert.deepEqual(saved, {sub: 's1', name: 'Ada Example', givenName: 'Ada', familyName: 'Example', email: 'ada@example.test', connectedAt: '2026-10-10T12:00:00.000Z'});
});

test('the window offers connect, use my name and email, and disconnect; the app answers each', () => {
  const page = read('../../../renderer/pages/experience.js'), handlers = read('../../../lib/experience-handlers.js'), preload = read('../../../preload.cjs'), html = read('../../../renderer/index.html');
  assert.match(html, /id="exp-linkedin-line"/);
  for (const text of ['Connect with LinkedIn', 'Use my name and email', 'Disconnect']) assert.ok(page.includes(text), text);
  assert.match(page, /saveContactField\(key/, 'fills only through the existing one-detail save, which merges and never replaces');
  assert.match(page, /!String\(contact\?\.\[key\] \|\| ''\)\.trim\(\)/, 'only details that are still empty');
  for (const name of ['linkedinStatus', 'linkedinConnect', 'linkedinDisconnect']) {
    assert.match(handlers, new RegExp(`ipcMain.handle\\('${name}'`), name);
    assert.match(preload, new RegExp(`${name}: call\\('${name}'\\)`), name);
  }
  assert.doesNotMatch(handlers, /appLog\('linkedin', [^)]*(name|email)/, 'the log says that it happened, never who');
});
