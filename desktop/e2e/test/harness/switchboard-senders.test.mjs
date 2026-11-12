// Guard: the CI senders that moved onto the owner's switchboard (nt 3/4c) keep their old contracts. The workflow -> event table gives every ci-alert call its event; `state`/`level` carry what "changes only" and
// "only problems" compare; a send() line that means "held on purpose" is DONE for the callers that used to compare 'ci-alert: sent'; the Build Log bot is the fail-open fallback of telegram-post. Fake fetch only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {delivered, send} from '../../ci-alert.mjs';
import {WORKFLOW_EVENTS, eventOfWorkflow, stateOf} from '../../lib/alert-events.mjs';
import {postTelegram} from '../../lib/telegram-post.mjs';
import {alertCreditOut} from '../../credit-alert.mjs';

const KEY = {SELFHEAL_PUBLISH_KEY: 'k', CI_ALERTS_TELEGRAM_BOT_TOKEN: '1:OLD', CI_ALERTS_TELEGRAM_CHAT_ID: '4', BUILDLOG_TELEGRAM_TOKEN: '2:LOG', BUILDLOG_TELEGRAM_CHAT: '5'};
function net(site) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({url: String(url), body: init.body ? JSON.parse(init.body) : null});
    return String(url).includes('/ops/notify') ? new Response(JSON.stringify(site.body ?? {}), {status: site.status}) : new Response('{"ok":true}', {status: 200});
  };
  return {fetcher, site: () => calls.filter(c => c.url.includes('/ops/notify')), bot: () => calls.filter(c => c.url.includes('api.telegram.org'))};
}

test('every workflow that calls ci-alert.mjs and has a registry alert maps to it; an unmapped one stays on the old bot', () => {
  const at = file => ({GITHUB_WORKFLOW_REF: `o/jobadabra/.github/workflows/${file}@refs/heads/main`});
  assert.deepEqual(Object.fromEntries(Object.keys(WORKFLOW_EVENTS).map(file => [file, eventOfWorkflow(at(file))])), WORKFLOW_EVENTS);
  assert.deepEqual([eventOfWorkflow(at('daily.yml')), eventOfWorkflow({})], ['', '']);   // daily/mail/scout are the person's own product notifications: never on the owner's switchboard
  assert.equal(eventOfWorkflow(at('site-replays.yml')), 'replay-drift');
});

test('level: a failure is a problem, a recovery an all-clear; and NO state is sent, so a later identical red is never held as "same state" behind a green that was never recorded', () => {
  assert.deepEqual([stateOf('failure', [{name: 'suite-a'}]), stateOf('success')], [{level: 'problem'}, {level: 'ok'}]);
  assert.ok(!('state' in stateOf('failure')));
});

test('delivered(): sent and held are done; a refusal or "not sent" is not', () => {
  assert.deepEqual(['ci-alert: sent', 'ci-alert: held (off)', 'ci-alert: not sent (Telegram 400)', 'ci-alert: nothing to send'].map(delivered), [true, true, false, false]);
});

test('send() with an event: delivered by the switchboard is the same line as before; held by the owner\'s switch is a "held" line and the old bot stays quiet', async () => {
  const sent = net({status: 200, body: {ok: true, sent: true}});
  assert.equal(await send('x', KEY, sent.fetcher, {event: 'main-red', state: 'red:1', level: 'problem'}), 'ci-alert: sent');
  assert.deepEqual([sent.site()[0].body.state, sent.site()[0].body.level, sent.bot().length], ['red:1', 'problem', 0]);
  const held = net({status: 200, body: {ok: true, sent: false, why: 'same-state'}});
  assert.match(await send('x', KEY, held.fetcher, {event: 'main-red'}), /^ci-alert: held \(same-state\)/);
  assert.equal(held.bot().length, 0);
});

test('credit-alert: a held alert is delivered for its marker; a switchboard that cannot deliver still reaches the old bot', async () => {
  const held = net({status: 200, body: {ok: true, sent: false, why: 'daily'}});
  const line = await alertCreditOut({provider: 'x', text: 'credit balance is too low', always: true, env: KEY, fetcher: held.fetcher});
  assert.ok(delivered(line), line);
  assert.equal(held.site()[0].body.event, 'ai-credit');
  const down = net({status: 503, body: {ok: false, why: 'channel-not-connected'}});
  await alertCreditOut({provider: 'x', text: 'credit balance is too low', always: true, env: KEY, fetcher: down.fetcher});
  assert.equal(down.bot().length, 1);
});

test('send: the old bot reports its alert\'s state to the switchboard, so a repeat is held after the channel is back (8 Nov 2026: "red on main" told twice)', async () => {
  const down = net({status: 503, body: {ok: false, why: 'channel-not-connected'}});
  assert.equal(await send('x', KEY, down.fetcher, {event: 'main-red', state: 'red:abc:2026-11-08'}), 'ci-alert: sent');
  assert.deepEqual(down.site().at(-1).body, {event: 'main-red', fallback: true, state: 'red:abc:2026-11-08'});
});

test('telegram-post (the Build Log bot): the switchboard first when it has an event, the Build Log bot when it cannot deliver, and no event is the old path exactly', async () => {
  const ok = net({status: 200, body: {ok: true, sent: true}});
  assert.equal(await postTelegram('hello', {env: KEY, fetcher: ok.fetcher, event: 'record-sites'}), 'telegram: sent');
  assert.deepEqual([ok.site().length, ok.bot().length], [1, 0]);
  const down = net({status: 503, body: {ok: false}});
  assert.equal(await postTelegram('hello', {env: KEY, fetcher: down.fetcher, event: 'record-sites'}), 'telegram: sent');
  assert.deepEqual([down.bot().length, down.bot()[0].url.includes('/bot2:LOG/'), down.site().at(-1).body], [1, true, {event: 'record-sites', fallback: true}]);
  const plain = net({status: 200, body: {}});
  await postTelegram('hello', {env: KEY, fetcher: plain.fetcher});
  assert.deepEqual([plain.site().length, plain.bot().length], [0, 1]);
});

test('a caller with its own bot (the CI-alerts bot of the AI fixer and the scorecard): the switchboard first, that bot when it cannot deliver, and a missing bot says so', async () => {
  const bot = {token: '1:OLD', chat: '4'};
  const ok = net({status: 200, body: {ok: true, sent: true}});
  assert.equal(await postTelegram('hi', {env: KEY, fetcher: ok.fetcher, event: 'ai-fixer-round', bot}), 'telegram: sent');
  assert.deepEqual([ok.site()[0].body.event, ok.bot().length], ['ai-fixer-round', 0]);
  const down = net({status: 503, body: {ok: false}});
  await postTelegram('hi', {env: KEY, fetcher: down.fetcher, event: 'ai-fixer-round', bot});
  assert.deepEqual([down.bot().length, down.bot()[0].url.includes('/bot1:OLD/')], [1, true]);
  const none = net({status: 503, body: {ok: false}});
  assert.match(await postTelegram('hi', {env: KEY, fetcher: none.fetcher, event: 'ai-fixer-round', bot: {token: '', chat: ''}}), /not sent \(the bot token/);
});

test('tell-owner.mjs reads the message file and sends it with the CI-alerts bot behind the switchboard', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tell-')), 'message.txt');
  fs.writeFileSync(file, 'Scorecard: 3 checks slow\n');
  const real = globalThis.fetch, calls = [], argv = process.argv;
  globalThis.fetch = async (url, init = {}) => { calls.push({url: String(url), body: init.body ? JSON.parse(init.body) : null}); return new Response(String(url).includes('/ops/notify') ? '{"ok":false}' : '{"ok":true}', {status: String(url).includes('/ops/notify') ? 503 : 200}); };
  process.argv = [argv[0], argv[1], '--event', 'pr-check-scorecard', '--file', file];
  try {
    const {main} = await import('../../tell-owner.mjs');
    assert.equal(await main(KEY), 'telegram: sent');
  } finally { globalThis.fetch = real; process.argv = argv; }
  const bot = calls.find(c => c.url.includes('api.telegram.org'));
  assert.deepEqual([calls[0].body.event, bot.url.includes('/bot1:OLD/'), bot.body.text], ['pr-check-scorecard', true, 'Scorecard: 3 checks slow']);
});

test('tellOwner (the AI-refusal alert of web\'s digest and changelog jobs, the weekly e2e summary): the switchboard first with its event, the CI-alerts bot only when it cannot deliver, held is delivered (12 Nov 2026)', async () => {
  const {tellOwner} = await import('../../../../tools/ci-intel/lib/ai-refusal.mjs');
  const ok = net({status: 200, body: {ok: true, sent: true}});
  assert.deepEqual(await tellOwner('x', {env: KEY, fetch: ok.fetcher}), {sent: true});
  assert.deepEqual([ok.site()[0].body.event, ok.bot().length], ['ai-credit', 0]);
  const weekly = net({status: 200, body: {ok: true, sent: false, why: 'off'}});
  assert.deepEqual(await tellOwner('x', {env: KEY, fetch: weekly.fetcher, event: 'e2e-weekly'}), {sent: true});
  assert.deepEqual([weekly.site()[0].body.event, weekly.bot().length], ['e2e-weekly', 0]);
  const down = net({status: 503, body: {ok: false}});
  assert.deepEqual(await tellOwner('x', {env: KEY, fetch: down.fetcher}), {sent: true});
  assert.deepEqual([down.bot().length, down.bot()[0].url.includes('/bot1:OLD/'), down.site().at(-1).body], [1, true, {event: 'ai-credit', fallback: true}]);
  const keyless = net({status: 200, body: {}});
  const {SELFHEAL_PUBLISH_KEY, ...noKey} = KEY;
  assert.deepEqual(await tellOwner('x', {env: noKey, fetch: keyless.fetcher}), {sent: true});
  assert.deepEqual([keyless.site().length, keyless.bot().length], [0, 1]);
  assert.match((await tellOwner('x', {env: {}, fetch: keyless.fetcher})).skipped, /no Telegram bot token/);
});
