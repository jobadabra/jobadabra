// The app's wall reads the website's count (lib/trial-server.js): the highest count and earliest first run win, Pro is never over, offline the local numbers stand.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {create} from '../../../lib/license.js';
import {refresh} from '../../../lib/trial-server.js';
import {strictSetSecret} from '../../strict-set-secret.js';

const FREE = 'JPF1.install-0001.tok', now = Date.parse('2026-10-16T10:00:00Z');
function store(settings = {}, secrets = {ANTHROPIC_API_KEY: FREE}) {
  const mine = {firstRunAt: '2026-10-10T00:00:00.000Z', ...settings};
  return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch), secret: name => secrets[name] || '', setSecret: strictSetSecret()};
}
const answer = body => async () => Response.json({ok: true, ...body});

test('the server knows more applications and an older first run: the app is over, as Always on is', async () => {
  const st = store(), license = create(st, {appliedNow: () => 3, now: () => now});
  assert.equal(license.state().ended, false);
  assert.equal(await refresh(st, license, {fetcher: answer({used: 22, first: '2026-07-01T00:00:00.000Z', pro: false})}), true);
  assert.deepEqual([license.state().ended, license.state().used], [true, 22]);
  assert.ok(license.blocked());
});

test('a lower server count cannot lift the wall, and Pro is never over', async () => {
  const st = store({firstRunAt: '2026-07-01T00:00:00.000Z'}), license = create(st, {appliedNow: () => 25, now: () => now});
  await refresh(st, license, {fetcher: answer({used: 0, first: '2026-10-16T00:00:00.000Z', pro: false})});
  assert.equal(license.state().ended, true);
  await refresh(st, license, {fetcher: answer({used: 25, first: '2026-07-01T00:00:00.000Z', pro: true})});
  assert.deepEqual([license.state().ended, license.blocked()], [false, null]);
});

test('offline, refused or without a key: the local numbers stand and nothing throws', async () => {
  const st = store({firstRunAt: '2026-07-01T00:00:00.000Z'}), license = create(st, {appliedNow: () => 25, now: () => now});
  assert.equal(await refresh(st, license, {fetcher: async () => { throw new Error('offline'); }}), false);
  assert.equal(await refresh(st, license, {fetcher: async () => new Response('{}', {status: 401})}), false);
  assert.equal(license.state().ended, true);
  assert.equal(await refresh(store({}, {}), license, {fetcher: () => assert.fail('asked')}), false);
});

// Why (fb 2/7, 5 Nov 2026): a thanked reporter has 5 more free applications; the app's wall and its "N of M" line move with the site's `bonus`, never past the site's answer.
test('the site adds a bonus: 22 applications past 60 days are no longer over, 25 are, and the line says 25', async () => {
  const st = store({firstRunAt: '2026-07-01T00:00:00.000Z'}), license = create(st, {appliedNow: () => 22, now: () => now});
  assert.equal(license.state().ended, true, 'without a bonus 22 of 20 is over');
  await refresh(st, license, {fetcher: answer({used: 22, first: '2026-07-01T00:00:00.000Z', pro: false, bonus: 5})});
  assert.deepEqual([license.state().ended, license.state().limit, license.state().bonus, license.blocked()], [false, 25, 5, null]);
  const over = create(st, {appliedNow: () => 25, now: () => now}).state();
  assert.deepEqual([over.ended, over.limit], [true, 25]);
  await refresh(st, license, {fetcher: answer({used: 22, first: '2026-07-01T00:00:00.000Z', pro: false, bonus: -3})});
  assert.equal(license.state().limit, 20, 'a negative or odd bonus counts as none');
});
