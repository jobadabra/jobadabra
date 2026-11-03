// The call that tells the website which pull requests a stable release carries (tools/feedback-released.mjs; spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md in jobadabra-web, PR 6/7).
// Owner, 3 Nov 2026: reporters hear "fixed" when the build is stable; mac-07: a slow or failing call never fails, delays or blocks a release. The GitHub API, the site and Telegram are all recorded fakes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {post, prNumbers, previousStable, tellSite} from '../../tools/feedback-released.mjs';

const TAG = 'desktop-v0.9.13', ENV = {GITHUB_REPOSITORY: 'jobadabra/jobadabra', GH_TOKEN: 'gh', SELFHEAL_PUBLISH_KEY: 'publish-key', CI_ALERTS_TELEGRAM_BOT_TOKEN: 'bot', CI_ALERTS_TELEGRAM_CHAT_ID: '1', GITHUB_RUN_ID: '77'};
const json = (body, status = 200) => ({ok: status < 400, status, json: async () => body});

// A fake network: GitHub (commit, releases, compare), the site and Telegram. `site` answers the POSTs in turn (a function or a list); every request is recorded.
function network({site = [json({ok: true, told: 2, waiting: 1, matched: [], failed: []})], github = {}} = {}) {
  const calls = [], answers = [].concat(site);
  const fetcher = async (url, init = {}) => {
    calls.push({url: String(url), init});
    if (url.includes('api.telegram.org')) return json({ok: true});
    if (url.includes('/commits/')) return github.commit ?? json({sha: 'abc1234def5678', commit: {message: 'Release x (#3060)', committer: {date: '2026-11-04T08:00:00Z'}}});
    if (url.includes('/releases?')) return github.releases ?? json([{tag_name: TAG, prerelease: false}, {tag_name: 'desktop-v0.9.14-beta', prerelease: true}, {tag_name: 'desktop-v0.9.12', prerelease: false}, {tag_name: 'desktop-v0.9.2', prerelease: false}]);
    if (url.includes('/compare/')) return github.compare ? github.compare(url) : json({total_commits: 3, commits: [{commit: {message: '[a] Fix one (#3012)\n\nbody (#1)'}}, {commit: {message: 'Merge branch main'}}, {commit: {message: '[b] Fix two (#3020)'}}]});
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  };
  return {fetcher, calls, site: () => calls.filter(call => call.url.includes('/api/feedback/released')), telegram: () => calls.filter(call => call.url.includes('api.telegram.org'))};
}

test('pull request numbers are the "(#n)" ending a commit subject; the version order is numeric, not alphabetical', () => {
  assert.deepEqual(prNumbers(['[02] [fd] x (#345)', 'Merge branch', '[a] y (#12)\nbody (#99)', 'see (#7) here', '(#12)']), [12, 345]);
  assert.deepEqual(prNumbers(['[a] Fix (#12)', '[b] Other (#14)', 'Revert "[a] Fix (#12)" (#13)']), [13, 14], 'a fix and its revert in one range: the fix is not announced');
  assert.equal(previousStable(['desktop-v0.9.2', 'desktop-v0.9.12', TAG, 'desktop-v0.10.0'], TAG), 'desktop-v0.9.12', '0.9.12 is older than 0.9.13 and 0.10.0 is newer');
  assert.equal(previousStable(['desktop-v0.9.12'], 'latest'), '');
  assert.equal(previousStable([], TAG), '');
});

test('a stable release posts its version, channel, the PRs since the previous stable and the commit time, with the publish key', async () => {
  const net = network(), done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  assert.equal(done.ok, true, done.line);
  const [call] = net.site();
  assert.equal(call.init.headers.Authorization, 'Bearer publish-key');
  assert.deepEqual(JSON.parse(call.init.body), {version: '0.9.13', channel: 'stable', prs: [3012, 3020], cutAt: '2026-11-04T08:00:00.000Z'});
  assert.ok(net.calls.some(c => c.url.includes('/compare/desktop-v0.9.12...desktop-v0.9.13')), 'the range starts at the previous stable, a beta in between is not one');
  assert.match(done.line, /told 2, still waiting 1/);
  assert.equal(net.telegram().length, 0, 'nothing to say when it went well');
});

test('every request is bounded by a timeout, so a hanging site or GitHub cannot hold the run', async () => {
  const net = network(); await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  const unbounded = net.calls.filter(call => !(call.init.signal instanceof AbortSignal)).map(call => call.url);
  assert.deepEqual(unbounded, [], 'a request with no signal can wait for ever');
});

test('a site that is down or slow is tried 3 times, then one Telegram note and a failed result, never a throw', async () => {
  for (const site of [json({ok: false}, 503), Object.assign(new Error('timed out'), {name: 'TimeoutError'})]) {
    const net = network({site}), done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
    assert.equal(done.ok, false);
    assert.equal(net.site().length, 3, 'three tries');
    assert.equal(net.telegram().length, 1, 'one note');
    assert.match(JSON.parse(net.telegram()[0].init.body).text, /not told/i);
    assert.doesNotMatch(done.line + net.telegram()[0].init.body, /publish-key/, 'the key is never printed or sent');
  }
});

test('a refusal (401, 400) is final: one try, one note that names the status', async () => {
  const net = network({site: json({ok: false, error: 'unauthorized'}, 401)}), done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  assert.deepEqual([done.ok, net.site().length, net.telegram().length], [false, 1, 1]);
  assert.match(done.line, /answered 401/);
});

test('a 5xx that recovers on the second try is a success with no note', async () => {
  const net = network({site: [json({ok: false}, 502), json({ok: true, told: 1, waiting: 0, failed: []})]}), done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  assert.deepEqual([done.ok, net.site().length, net.telegram().length], [true, 2, 0]);
});

test('no publish key, a GitHub that fails and a tag that is not a desktop tag never reach the site and never throw', async () => {
  let net = network(); let done = await tellSite({tag: TAG, env: {...ENV, SELFHEAL_PUBLISH_KEY: ''}, fetcher: net.fetcher, wait: 0});
  assert.deepEqual([done.ok, net.site().length, net.telegram().length], [false, 0, 1]);
  net = network({github: {commit: json({}, 404)}}); done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  assert.deepEqual([done.ok, net.site().length, net.telegram().length], [false, 0, 1]);
  net = network({github: {compare: () => json({}, 500)}}); done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  assert.deepEqual([done.ok, net.site().length, net.telegram().length], [false, 0, 1]);
  net = network(); done = await tellSite({tag: 'main', env: ENV, fetcher: net.fetcher, wait: 0});
  assert.deepEqual([done.ok, net.calls.length], [false, 0]);
});

test('reporters the site could not confirm are told to the owner by refs count only, and the run still succeeds', async () => {
  const net = network({site: json({ok: true, told: 1, waiting: 0, matched: [], failed: ['aaaa000011112222']})}), done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  assert.equal(done.ok, true);
  assert.match(done.line, /NOT confirmed 1/);
  const text = JSON.parse(net.telegram()[0].init.body).text;
  assert.match(text, /not confirmed/i);
  assert.doesNotMatch(text, /aaaa000011112222/, 'no ref in the message');
});

test('post() stops at a 4xx and gives the last answer after the last try', async () => {
  let n = 0;
  const answer = await post('https://x/y', 'k', {}, {fetcher: async () => json({}, ++n < 5 ? 500 : 200), tries: 2, wait: 0});
  assert.deepEqual([answer.ok, answer.status, answer.tries, n], [false, 500, 2, 2]);
});

test('a range of more than 500 commits is read to its end: the newest pull requests (the ones this release is about) are in the list', async () => {
  const commits = page => Array.from({length: page === 7 ? 50 : 100}, (_, i) => ({commit: {message: `[x] change ${page}-${i} (#${page * 1000 + i})`}}));
  const net = network({github: {compare: url => json({total_commits: 650, commits: commits(Number(new URL(url).searchParams.get('page')))})}});
  const done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0}), body = JSON.parse(net.site()[0].init.body);
  assert.equal(done.ok, true, done.line);
  assert.equal(body.prs.length, 650, 'every commit of the range');
  assert.ok(body.prs.includes(7049) && body.prs.includes(1000), 'the newest (page 7) and the oldest (page 1)');
});

test('a range too long to read is a loud failure, never a silently cut list', async () => {
  const net = network({github: {compare: () => json({total_commits: 3500, commits: []})}}), done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  assert.deepEqual([done.ok, net.site().length, net.telegram().length], [false, 0, 1]);
  assert.match(done.line, /3500 commits/);
});

test('an odd "failed" from the site is not a failure of ours', async () => {
  const net = network({site: json({ok: true, told: 1, waiting: 0, failed: null})}), done = await tellSite({tag: TAG, env: ENV, fetcher: net.fetcher, wait: 0});
  assert.deepEqual([done.ok, net.telegram().length], [true, 0]);
});
