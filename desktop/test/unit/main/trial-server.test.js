// The app's wall reads the website's count (lib/trial-server.js): the highest count and earliest first run win, Pro is never over, offline the local numbers stand.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {create, text} from '../../../lib/license.js';
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
test('the site adds a bonus: 22 applications past 60 days are no longer over, 25 are, and the line says 22 of 25', async () => {
  const st = store({firstRunAt: '2026-07-01T00:00:00.000Z'}), license = create(st, {appliedNow: () => 22, now: () => now});
  assert.equal(license.state().ended, true, 'without a bonus 22 of 20 is over');
  await refresh(st, license, {fetcher: answer({used: 22, first: '2026-07-01T00:00:00.000Z', pro: false, bonus: 5})});
  assert.deepEqual([license.state().ended, license.state().limit, license.state().bonus, license.blocked()], [false, 25, 5, null]);
  assert.match(text(license.state()), /^22 of 25 free applications/);
  const over = create(st, {appliedNow: () => 25, now: () => now}).state();
  assert.deepEqual([over.ended, over.limit], [true, 25]);
  await refresh(st, license, {fetcher: answer({used: 22, first: '2026-07-01T00:00:00.000Z', pro: false, bonus: -3})});
  assert.equal(license.state().limit, 20, 'a negative bonus counts as none');
  await refresh(st, license, {fetcher: answer({used: 22, first: '2026-07-01T00:00:00.000Z', pro: false, bonus: 'x'})});
  assert.equal(license.state().limit, 20, 'a non-number counts as none');
  await refresh(st, license, {fetcher: answer({used: 22, first: '2026-07-01T00:00:00.000Z', pro: false, bonus: 2.7})});
  assert.equal(license.state().limit, 22, 'a fraction counts its whole part');
});

// Owner, 10 Nov 2026 (asked via AskUserQuestion "App sends a flag"): a trial on its own AI has 30 free applications; the app only says it is on its own AI, never sends the key.
// Gitar on #3655: "Free off" is not an own AI; the site's bonus here follows the flag, so the number on the line proves the flag was sent.
const OWN = 'sk-ant-api03-owner-test-key';
async function lineFor(settings, secrets) {
  const asked = [];
  const fetcher = async (url, init) => { asked.push({url: String(url), headers: init.headers}); return Response.json({ok: true, used: 12, first: '2026-10-10T00:00:00.000Z', pro: false, bonus: /[?&]own_ai=1\b/.test(String(url)) ? 10 : 0}); };
  const st = store(settings, secrets), license = create(st, {appliedNow: () => 12, now: () => now});
  assert.equal(await refresh(st, license, {fetcher}), true);
  return {asked, line: text(license.state())};
}

test('on its own API key the app tells the site with a flag (never the key) and the line says 12 of 30', async () => {
  const {asked, line} = await lineFor({aiFree: false, aiEngine: 'api'}, {ANTHROPIC_API_KEY: OWN, JOBADABRA_TRIAL_KEY: FREE});
  assert.match(asked[0].url, /[?&]own_ai=1\b/);
  assert.ok(!asked[0].url.includes('sk-ant') && !JSON.stringify(asked[0].headers).includes('sk-ant'), 'no key of theirs leaves the Mac');
  assert.match(line, /^12 of 30 free applications/);
});

test('on their own Claude/ChatGPT subscription engine too, even when Free AI was started once and its flag is still set', async () => {
  for (const settings of [{aiFree: false, aiEngine: 'cli'}, {aiFree: true, aiEngine: 'cli'}, {aiFree: true, aiEngine: 'codex'}]) {
    assert.match((await lineFor(settings, {JOBADABRA_TRIAL_KEY: FREE})).line, /^12 of 30 free applications/, JSON.stringify(settings));
  }
});

test('Free AI in charge, or Free AI left with no AI of their own (only the install\'s trial token), sends no flag: 12 of 20', async () => {
  for (const [settings, secrets] of [[{aiFree: true}, {ANTHROPIC_API_KEY: FREE}], [{aiFree: false}, {JOBADABRA_TRIAL_KEY: FREE}], [{aiFree: true, aiEngine: 'api'}, {ANTHROPIC_API_KEY: FREE, JOBADABRA_TRIAL_KEY: FREE}]]) {
    const {asked, line} = await lineFor(settings, secrets);
    assert.doesNotMatch(asked[0].url, /own_ai/, JSON.stringify(settings));
    assert.match(line, /^12 of 20 free applications/);
  }
});
