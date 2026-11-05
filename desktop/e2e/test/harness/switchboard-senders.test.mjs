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
  assert.deepEqual([eventOfWorkflow(at('site-replays.yml')), eventOfWorkflow({})], ['', '']);
});

test('state and level: a failure is red with its failed jobs (the same jobs = the same state) and a problem; a recovery is green and an all-clear', () => {
  const a = stateOf('failure', [{name: 'suite-b'}, {name: 'suite-a'}]), b = stateOf('failure', [{name: 'suite-a'}, {name: 'suite-b'}, {name: 'suite-a'}]);
  assert.deepEqual([a.state === b.state, a.level, stateOf('failure', [{name: 'suite-c'}]).state === a.state], [true, 'problem', false]);
  assert.deepEqual(stateOf('success'), {state: 'green', level: 'ok'});
  assert.ok(a.state.length <= 60);
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
