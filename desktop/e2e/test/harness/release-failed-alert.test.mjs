// Guard: a release that ends without reaching testers or stable tells the owner (owner, 5 Nov 2026: "I didn't get any notification. I should have", beta 0.9.12, run 42056409953:
// the Mac build failed, no lane was offered, and the only alert step is skipped when nothing was offered). One alert names the version, the lane, the step and the run link; through the
// switchboard first (Admin → Operations → Notifications), the old CI-alerts bot when the switchboard cannot deliver. Fake fetch only: never the real Telegram or site.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {alertReleaseFailed, failedLanes} from '../../release-failed-alert.mjs';
import {send} from '../../ci-alert.mjs';

const RUN = {GITHUB_REPOSITORY: 'o/jobadabra', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '42056409953', SELFHEAL_PUBLISH_KEY: 'key-1',
  CI_ALERTS_TELEGRAM_BOT_TOKEN: '111:OLD', CI_ALERTS_TELEGRAM_CHAT_ID: '42'};
const ok = {result: 'success'}, skipped = {result: 'skipped'}, failure = {result: 'failure'};
// What `toJSON(needs)` of the beta's last job holds: Mac's build failed (so its tests and release were skipped), Windows built but its E2E gate went red.
const OWNERS_RUN = {changes: ok, build: failure, windows: ok, 'test-mac': skipped, 'test-windows': failure, 'release-mac': skipped, 'release-windows': skipped, 'release-mac-offer': skipped, 'release-windows-offer': skipped};

// A fake site + Telegram: records every call; `site` is the status /ops/notify answers (or 'down').
function net({site = 503, body = {ok: false, why: 'channel-not-connected'}} = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null});
    if (String(url).includes('/ops/notify')) { if (site === 'down') throw new Error('network'); return new Response(JSON.stringify(body), {status: site}); }
    return new Response('{"ok":true}', {status: 200});
  };
  return {calls, fetcher, site: () => calls.filter(call => call.url.includes('/ops/notify')), bot: () => calls.filter(call => call.url.includes('api.telegram.org'))};
}

test('failedLanes: the first stage that is not green names the step; a skipped stage after a failure is never the cause', () => {
  assert.deepEqual(failedLanes(OWNERS_RUN), [{lane: 'Mac', step: 'Build', result: 'failure'}, {lane: 'Windows', step: 'E2E gate', result: 'failure'}]);
  assert.deepEqual(failedLanes({...OWNERS_RUN, build: ok, 'test-mac': skipped}).map(l => [l.lane, l.step]), [['Mac', 'E2E gate'], ['Windows', 'E2E gate']], 'a green build whose gate was skipped: the gate did not run');
  assert.deepEqual(failedLanes({...OWNERS_RUN, build: ok, 'test-mac': ok, 'release-mac': failure}).map(l => [l.lane, l.step])[0], ['Mac', 'Lane check']);
});

test('the owner\'s run: a beta whose build fails sends ONE alert naming the version, the lane, the step and the run link', async () => {
  const n = net({site: 503});
  const line = await alertReleaseFailed({kind: 'beta', version: '0.9.12', needs: OWNERS_RUN, env: RUN, fetcher: n.fetcher});
  assert.match(line, /sent/);
  const text = n.site()[0].body.text;
  assert.equal(n.site()[0].body.event, 'release-failed');
  for (const word of ['0.9.12', 'Mac', 'Build', 'Windows', 'E2E gate', 'https://github.com/o/jobadabra/actions/runs/42056409953']) assert.ok(text.includes(word), `${word} in: ${text}`);
  assert.equal(n.bot().length, 1, 'the switchboard could not deliver (Engineering not connected): the old CI-alerts bot sends it, once');
  assert.ok(n.bot()[0].url.includes('/bot111:OLD/'));
  assert.deepEqual(n.site().at(-1).body, {event: 'release-failed', fallback: true}, 'and the switchboard is told it was sent without it');
});

test('the switchboard first: when it delivers or holds the alert (owner\'s switch), the old bot is not used', async () => {
  const delivered = net({site: 200, body: {ok: true, sent: true, id: 5}});
  await alertReleaseFailed({kind: 'beta', version: '0.9.12', needs: OWNERS_RUN, env: RUN, fetcher: delivered.fetcher});
  assert.deepEqual([delivered.site().length, delivered.bot().length], [1, 0]);
  assert.equal(delivered.site()[0].headers.Authorization, 'Bearer key-1');
  assert.equal(delivered.site()[0].url, 'https://www.jobadabra.top/ops/notify');
  const held = net({site: 200, body: {ok: true, sent: false, why: 'off'}});
  const line = await alertReleaseFailed({kind: 'beta', version: '0.9.12', needs: OWNERS_RUN, env: RUN, fetcher: held.fetcher});
  assert.deepEqual([held.bot().length, /off/.test(line)], [0, true]);
});

test('fail-open: the site down, no key, or an event the site does not know all still reach the owner through the old bot', async () => {
  for (const [name, n, env] of [['site down', net({site: 'down'}), RUN], ['no key', net(), {...RUN, SELFHEAL_PUBLISH_KEY: ''}], ['unknown event', net({site: 400, body: {ok: false, why: 'unknown-event'}}), RUN]]) {
    await alertReleaseFailed({kind: 'beta', version: '0.9.12', needs: OWNERS_RUN, env, fetcher: n.fetcher});
    assert.equal(n.bot().length, 1, name);
  }
});

test('no alert when a lane WAS offered (the release alert says which lane missed), when the run was cancelled, or when nothing failed', async () => {
  for (const needs of [{...OWNERS_RUN, windows: ok, 'test-windows': ok, 'release-windows': ok, 'release-windows-offer': ok},
    {...OWNERS_RUN, build: {result: 'cancelled'}, windows: {result: 'cancelled'}, 'test-windows': skipped},
    {changes: ok, build: ok, windows: ok, 'test-mac': ok, 'test-windows': ok, 'release-mac': ok, 'release-windows': ok, 'release-mac-offer': ok, 'release-windows-offer': ok}]) {
    const n = net();
    assert.match(await alertReleaseFailed({kind: 'beta', version: '0.9.12', needs, env: RUN, fetcher: n.fetcher}), /nothing to tell/);
    assert.equal(n.calls.length, 0);
  }
});

test('a failing alert never fails the release: a throwing network gives a line, not an error', async () => {
  const line = await alertReleaseFailed({kind: 'beta', version: '0.9.12', needs: OWNERS_RUN, env: RUN, fetcher: async () => { throw new Error('boom'); }});
  assert.match(line, /not sent/);
});

test('send(): without an event it is the old bot only, exactly as before', async () => {
  const n = net();
  assert.match(await send('hello', RUN, n.fetcher), /sent/);
  assert.deepEqual([n.site().length, n.bot().length], [0, 1]);
});
