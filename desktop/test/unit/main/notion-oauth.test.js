// Connect with Notion, app side (lib/notion-oauth.js): the state goes to the site, the token comes back to this app's own socket for that state only (lib/oauth-handoff.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as oauth from '../../../lib/notion-oauth.js';
import {receive} from '../../../lib/oauth-handoff.js';

test('Connect with Notion: opens the website with a random state, waits for the site to hand the token to this app, takes it once', async () => {
  let opened = '';
  const waiting = oauth.connect(url => { opened = url; }, {site: 'https://site.test'});
  await new Promise(r => setImmediate(r));
  assert.match(opened, /^https:\/\/site\.test\/api\/notion\/start\?state=[A-Za-z0-9_-]{43}$/);
  const state = new URL(opened).searchParams.get('state');
  assert.equal(receive('notion-connect', new URLSearchParams({state: 'x'.repeat(43), access_token: 'ntn_attacker'})), false, 'another state: dropped');
  assert.equal(receive('notion-connect', new URLSearchParams({state, access_token: 'ntn_user', workspace_name: 'Igor Mardari\'s Space', duplicated_template_id: ''})), true);
  assert.deepEqual(await waiting, {ok: true, access_token: 'ntn_user', workspace_name: 'Igor Mardari\'s Space', workspace_id: '', duplicated_template_id: null});
  assert.equal(receive('notion-connect', new URLSearchParams({state, access_token: 'ntn_user'})), false, 'used once');
});

test('no answer, cancelled, a browser that will not open, or no token: a clear message', async () => {
  assert.match((await oauth.connect(() => {}, {timeout: 5})).error, /5 minutes[^]*token instead/);
  const waiting = oauth.connect(() => {}, {});
  await new Promise(r => setImmediate(r));
  oauth.cancel();
  assert.equal((await waiting).error, 'Cancelled.');
  assert.match((await oauth.connect(() => { throw new Error('no browser'); })).error, /could not be opened/);
  let opened = '';
  const bare = oauth.connect(url => { opened = url; });
  await new Promise(r => setImmediate(r));
  receive('notion-connect', new URLSearchParams({state: new URL(opened).searchParams.get('state'), workspace_name: 'x'}));
  assert.match((await bare).error, /did not send a token/);
});
