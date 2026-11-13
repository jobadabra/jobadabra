// The merged search PRs behind the marks on the Night search chart (owner, 10 Nov 2026: "Each merged search PR shows as a mark on the Night search chart, written automatically; the tab goes"):
// what counts as search code, which PRs fall between two nights' builds, what a night that cannot be compared says, and that a GitHub failure never costs the upload. GitHub is a fake that
// answers in the real REST/GraphQL shapes (a path filter, a `since`, pages of 100). Guard for admin/search-night-prs.js and the ingest hook in admin/search-night.js.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {KEEP_PRS, SEARCH_PATHS, markNights, prsIn, runShas, searchCommits} from '../../../../admin/search-night-prs.js';
import {ingest, nights} from '../../../../admin/search-night.js';

const sha = digit => String(digit).repeat(40);
const ENV = {GITHUB_TOKEN: 't', GITHUB_REPO: 'jobadabra/jobadabra'};
const ROW = {persona: 1, label: 'p1', kind: 'measured', local: 3, found: 5, seconds: 60, ranOut: []};
const stored = (night, run, extra = {}) => ({night, run, state: 'success', head: '', rows: [ROW], ...extra});

// The repo as the fake GitHub knows it: builds a..d are the nightly runs' head shas; the commits are what main got between them (committer date, files, the PR GitHub links to the commit).
const RUNS = [{id: 901, head_sha: sha('a')}, {id: 902, head_sha: sha('b')}, {id: 903, head_sha: sha('c')}, {id: 904, head_sha: sha('d')}];
const DATES = {[sha('a')]: '2026-11-06T05:00:00Z', [sha('b')]: '2026-11-07T05:00:00Z', [sha('c')]: '2026-11-08T05:00:00Z', [sha('d')]: '2026-11-09T05:00:00Z'};
const commit = (oid, committedDate, messageHeadline, files, pr) => ({oid: sha(oid), committedDate, messageHeadline, files, pr});
const COMMITS = [
  commit('1', '2026-11-06T12:00:00Z', 'Pick boards by recency (#3592)', ['src/sources/boards.py'], {number: 3592, title: 'Pick boards by recency'}),
  commit('2', '2026-11-06T15:00:00Z', 'Fix a typo in the README (#3593)', ['README.md'], {number: 3593, title: 'Fix a typo in the README'}),
  commit('3', '2026-11-07T08:00:00Z', 'Rank sources by yield (#3624)', ['src/source_rank.py', 'src/press/rank.py'], {number: 3624, title: 'Rank sources by yield'}),   // two files, one PR
  commit('4', '2026-11-07T09:00:00Z', 'Titles: ask in batches (#3631)', ['src/ai/title_queue.py'], null),   // GitHub has no PR link: the "(#n)" of the squash subject is read
  commit('5', '2026-11-07T10:00:00Z', 'Hotfix straight on main', ['src/first_jobs.py'], null),
  commit('6', '2026-11-09T04:00:00Z', 'Judge: stricter place <b>x</b> (#3650)', ['tools/persona-search/gate_judge.py'], {number: 3650, title: 'Judge: stricter place <b>x</b>'}),
  commit('7', '2026-11-10T04:00:00Z', 'After the last night (#3660)', ['src/sources/eures.py'], {number: 3660, title: 'After the last night'}),
];
const inPath = (file, path) => file === path || file.startsWith(`${path}/`);

function github({commits = COMMITS, runs = RUNS, dates = DATES, fail = null} = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push(url);
    if (fail) return new Response('no', {status: fail});
    if (url.includes('/actions/workflows/search-personas.yml/runs')) return Response.json({workflow_runs: runs});
    const query = JSON.parse(init.body).query, answer = {}, object = {};
    for (const [, i, oid] of query.matchAll(/s(\d+): object\(oid: "([0-9a-f]{40})"\)/g)) answer[`s${i}`] = dates[oid] ? {committedDate: dates[oid]} : null;
    for (const [, i, path, since, after] of query.matchAll(/h(\d+): history\(path: "([^"]+)", since: "([^"]+)", first: 100(?:, after: "(\d+)")?\)/g)) {
      const tip = /object\(oid: "([0-9a-f]{40})"\)/.exec(query)[1], hits = commits.filter(item => item.committedDate >= since && item.committedDate <= (dates[tip] || '9') && item.files.some(file => inPath(file, path))), from = Number(after || 0);   // history from a tip reaches only what was merged up to it
      object[`h${i}`] = {pageInfo: {hasNextPage: from + 100 < hits.length, endCursor: String(from + 100)}, nodes: hits.slice(from, from + 100).map(item => ({oid: item.oid, committedDate: item.committedDate, messageHeadline: item.messageHeadline, associatedPullRequests: {nodes: item.pr ? [item.pr] : []}}))};
    }
    if (Object.keys(object).length) answer.object = object;
    return Response.json({data: {repository: answer}});
  };
  return {calls, fetcher};
}

// Every file under a folder, as repo paths.
const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));

// The repo files a yardstick pattern such as src/daily_search*.py or src/** stands for (a pattern with no star stands for itself).
// Why (10 Nov 2026, jobadabra #3684 turned the list into `src/**` plus `!src/...` exclusions; every web PR went red on this test, run 42885504405): GitHub's `paths:` takes `**` (any depth) and a leading `!` (leave the file out); the old reader
// took one folder level and read every line as an include, so it listed folders and the excluded files too.
function expand(glob) {
  if (!glob.includes('*')) return [glob];
  if (glob.endsWith('/**')) return existsSync(glob.slice(0, -3)) ? walk(glob.slice(0, -3)) : [];
  const dir = glob.slice(0, glob.lastIndexOf('/')), tail = glob.slice(glob.lastIndexOf('/') + 1), pattern = new RegExp(`^${tail.replace(/[.+]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return existsSync(dir) ? readdirSync(dir).filter(name => pattern.test(name)).map(name => `${dir}/${name}`) : [];
}

test('the search paths cover every stage file of the Find jobs pipeline yardstick, so a PR that moves its numbers is never missing', t => {
  const file = '.github/workflows/press-yardstick.yml';
  if (!existsSync(file)) return t.skip('the public workflow is not in this tree');
  const listed = [...readFileSync(file, 'utf8').split('workflow_dispatch:')[0].matchAll(/^\s+- '([^']+)'$/gm)].map(match => match[1]);
  const globs = listed.filter(glob => !glob.startsWith('!') && !glob.startsWith('tools/press-yardstick') && !glob.startsWith('.github/'));
  const left = new Set(listed.filter(glob => glob.startsWith('!')).flatMap(glob => expand(glob.slice(1))));
  assert.ok(globs.length >= 5 && listed.length >= 15, 'positive control: the yardstick list is read');
  const files = globs.flatMap(expand).filter(entry => !left.has(entry));
  assert.ok(!files.includes('src/ai/apply_batch.py') && files.includes('src/ai/score.py'), 'positive control: a `!` line leaves its file out and `**` reaches files in folders');
  assert.ok(files.some(entry => entry.startsWith('src/daily_search_')), 'positive control: a pattern is expanded to the repo files');
  assert.deepEqual(files.filter(entry => !SEARCH_PATHS.some(path => inPath(entry, path))), [], 'a stage file of the yardstick that the marks would miss');
});

test('the PRs of a window: after the earlier build, up to this one, one entry per PR, newest first, capped', () => {
  const commits = [{oid: 'a', date: '2026-11-07T08:00:00Z', n: 7, title: 'seven'}, {oid: 'b', date: '2026-11-07T09:00:00Z', n: 7, title: 'seven again'}, {oid: 'c', date: '2026-11-07T10:00:00Z', n: null, title: 'direct'}, {oid: 'd', date: '2026-11-08T05:00:00Z', n: 9, title: 'on the build'}, {oid: 'e', date: '2026-11-06T05:00:00Z', n: 1, title: 'on the earlier build'}];
  assert.deepEqual(prsIn(commits, '2026-11-06T05:00:00Z', '2026-11-08T05:00:00Z'), {prs: [{n: 9, title: 'on the build'}, {n: null, title: 'direct'}, {n: 7, title: 'seven again'}], more: 0});
  const many = Array.from({length: KEEP_PRS + 4}, (_, i) => ({oid: `o${i}`, date: `2026-11-07T${String(i).padStart(2, '0')}:00:00Z`, n: 100 + i, title: `t${i}`}));
  const capped = prsIn(many, '2026-11-06T00:00:00Z', '2026-11-08T00:00:00Z');
  assert.equal(capped.prs.length, KEEP_PRS);
  assert.equal(capped.more, 4);
  assert.equal(capped.prs[0].n, 100 + KEEP_PRS + 3, 'newest first');
  assert.deepEqual(prsIn([], 'a', 'b'), {prs: [], more: 0});
});

test('searchCommits asks once for every search path, reads the PR from GitHub\'s link or the squash subject, skips non-search files and pages a path with over 100 commits', async () => {
  const found = await searchCommits(ENV, sha('d'), '2026-11-05T00:00:00Z', github().fetcher);
  assert.deepEqual(found.find(item => item.oid === sha('4')), {oid: sha('4'), date: '2026-11-07T09:00:00Z', n: 3631, title: 'Titles: ask in batches'});
  assert.equal(found.find(item => item.oid === sha('5')).n, null, 'a direct push has no number');
  assert.equal(found.filter(item => item.oid === sha('3')).length, 1, 'a commit touching two search paths is one commit');
  assert.ok(!found.some(item => item.oid === sha('2')), 'a README change is not search code');
  const bulk = Array.from({length: 130}, (_, i) => ({...commit('9', `2026-11-08T${String(i % 24).padStart(2, '0')}:00:00Z`, `bulk ${i} (#${5000 + i})`, ['src/press/rank.py'], null), oid: String(i).padStart(40, '0')}));
  const fake = github({commits: bulk});
  const paged = await searchCommits(ENV, sha('d'), '2026-11-06T00:00:00Z', fake.fetcher);
  assert.equal(paged.length, 130, 'both pages of src/press were read');
  assert.equal(fake.calls.length, 2, 'one query for all paths, one more for the path that has a next page');
});

test('markNights files each night with the PRs between the builds of it and the night before; the oldest night and an unknown run say "nothing to compare", never "no PR"', async () => {
  const list = [stored('2026-11-09', 904), stored('2026-11-08', 903), stored('2026-11-07', 902), stored('2026-11-06', 901), stored('2026-11-05', 777)];
  const fake = github(), snapshot = JSON.stringify(list);
  const {nights: out, changed} = await markNights(ENV, list, fake.fetcher);
  assert.equal(changed, true);
  assert.equal(JSON.stringify(list), snapshot, 'the stored list is not changed in place');
  const by = Object.fromEntries(out.map(night => [night.night, night]));
  assert.deepEqual(by['2026-11-05'].build, null, 'run 777 is not a run GitHub lists');
  assert.equal(by['2026-11-05'].prs, null);
  assert.deepEqual(by['2026-11-06'].build, {sha: sha('a'), built: DATES[sha('a')]});
  assert.equal(by['2026-11-06'].prs, null, 'the night before has no known build: nothing to compare with');
  assert.deepEqual(by['2026-11-07'].prs, [{n: 3592, title: 'Pick boards by recency'}]);
  assert.deepEqual(by['2026-11-08'].prs, [{n: null, title: 'Hotfix straight on main'}, {n: 3631, title: 'Titles: ask in batches'}, {n: 3624, title: 'Rank sources by yield'}]);
  assert.deepEqual(by['2026-11-09'].prs, [{n: 3650, title: 'Judge: stricter place <b>x</b>'}], 'text is stored as it is; the page escapes it');
  assert.ok(!out.some(night => night.prs?.some(pr => pr.n === 3660 || pr.n === 3593)), 'a PR after the last build and a README PR are in no night');
  assert.equal(fake.calls.length, 3, 'one list of runs, one for the builds\' dates, one for the commits: not a call per night');
});

test('a night with no change between two builds has [] (a real "no PR"); a night is filled once and an unmarked new night is compared with the stored one', async () => {
  const same = [{id: 905, head_sha: sha('d')}];
  const list = [stored('2026-11-10', 905), stored('2026-11-09', 904, {build: {sha: sha('d'), built: DATES[sha('d')]}, prs: [{n: 3650, title: 'kept'}]})];
  const fake = github({runs: [...RUNS, ...same]});
  const {nights: out} = await markNights(ENV, list, fake.fetcher);
  assert.deepEqual(out[0].prs, [], 'same build as the night before');
  assert.deepEqual(out[1].prs, [{n: 3650, title: 'kept'}], 'a filled night is left alone');
  const again = await markNights(ENV, out, async () => assert.fail('nothing is left to fill: GitHub is not asked'));
  assert.equal(again.changed, false);
});

test('without a token, or when GitHub fails, nothing is filled and nothing half-filled is returned', async () => {
  const list = [stored('2026-11-07', 902), stored('2026-11-06', 901)];
  assert.equal((await markNights({}, list, async () => assert.fail('no token: no call'))).changed, false);
  await assert.rejects(markNights(ENV, list, github({fail: 502}).fetcher), /GitHub runs answered 502/);
  await assert.rejects(runShas(ENV, github({fail: 403}).fetcher), /403/);
  assert.ok(list.every(night => night.prs === undefined && night.build === undefined));
});

// ci_state as one row in memory: what ingest reads and writes.
function store() {
  const rows = new Map();
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), first: async () => (rows.has(args[0]) ? {body: rows.get(args[0])} : null), run: async () => { if (sql.startsWith('INSERT')) rows.set(args[0], args[1]); }});
  return {prepare: sql => statement(sql)};
}
const verdict = {state: 'success', head: 'measured 1 of 1', rows: [{persona: 1, label: 'p1', kind: 'measured', local: 3, found: 5, seconds: 60}]};

test('the upload fills the marks after it has stored the night; a GitHub failure leaves the night stored and the next upload tries again', async () => {
  const env = {STATS: store(), ...ENV, REPLAYS_PUBLISH_KEY: 'k'}, log = console.error, logged = [];
  console.error = line => logged.push(line);
  try {
    const first = await ingest(env, verdict, {night: '2026-11-08', run: '903'}, new Date('2026-11-08T06:00:00Z'), github().fetcher);
    assert.equal(first.body.marked, 0, 'no night got PRs: the first one has nothing to compare with, so its prs is null, not []');
    assert.equal((await nights(env))[0].prs, null);
    const NOW = new Date('2026-11-09T06:00:00Z'), failed = await ingest(env, verdict, {night: '2026-11-09', run: '904'}, NOW, github({fail: 502}).fetcher);
    assert.equal(failed.status, 200, 'the upload still succeeds');
    assert.equal(failed.body.marked, 'error');
    assert.ok(logged.some(line => /PR marks not filled: GitHub runs answered 502/.test(line)), 'the cause is in the Worker log');
    assert.equal((await nights(env)).find(night => night.night === '2026-11-09').prs, undefined, 'still to be filled');
    const retry = await ingest(env, verdict, {night: '2026-11-09', run: '904'}, NOW, github().fetcher);
    assert.equal(retry.body.marked, 1);
    assert.deepEqual((await nights(env)).find(night => night.night === '2026-11-09').prs, [{n: 3650, title: 'Judge: stricter place <b>x</b>'}], 'only what came after the 11/08 build');
  } finally { console.error = log; }
});

test('an upload that lands while GitHub answers is not lost: the marks are merged into a fresh read, never the list the call started from', async () => {
  const env = {STATS: store(), ...ENV, REPLAYS_PUBLISH_KEY: 'k'};
  await ingest(env, verdict, {night: '2026-11-08', run: '903'}, new Date('2026-11-08T06:00:00Z'), github().fetcher);
  const slowGithub = github(), answer = slowGithub.fetcher;
  const fetcher = async (url, init) => {
    if (url.includes('/graphql') && !env.landed) { env.landed = true; await ingest({...env, GITHUB_TOKEN: ''}, verdict, {night: '2026-11-10', run: '905'}, new Date('2026-11-10T06:00:00Z'), answer); }   // a second upload, mid-fill
    return answer(url, init);
  };
  const result = await ingest(env, verdict, {night: '2026-11-09', run: '904'}, new Date('2026-11-09T06:00:00Z'), fetcher);
  assert.equal(result.body.marked, 1);
  const kept = await nights(env);
  assert.deepEqual(kept.map(night => night.night), ['2026-11-10', '2026-11-09', '2026-11-08'], 'the night that landed meanwhile is still there');
  assert.deepEqual(kept[1].prs, [{n: 3650, title: 'Judge: stricter place <b>x</b>'}]);
  assert.equal(kept[0].prs, undefined, 'and still to be filled by the next upload');
});

test('a GitHub that does not answer holds the upload for the budget only; the night stays stored and unmarked', async () => {
  const env = {STATS: store(), ...ENV, REPLAYS_PUBLISH_KEY: 'k'};
  const started = Date.now(), result = await ingest(env, verdict, {night: '2026-11-08', run: '903'}, new Date('2026-11-08T06:00:00Z'), () => new Promise(() => {}), 40);
  assert.equal(result.status, 200);
  assert.equal(result.body.marked, 'slow');
  assert.ok(Date.now() - started < 2000);
  assert.equal((await nights(env))[0].prs, undefined);
});

test('a path with more commits than the paging reads is named, not marked with PRs missing', async () => {
  const bulk = Array.from({length: 1100}, (_, i) => ({...commit('9', '2026-11-08T05:00:00Z', `bulk ${i} (#${5000 + i})`, ['src/press/rank.py'], null), oid: String(i).padStart(40, '0')}));
  await assert.rejects(searchCommits(ENV, sha('d'), '2026-11-06T00:00:00Z', github({commits: bulk}).fetcher), /over 1000 commits/);
});

test('a night re-run by hand later has the newest build: history is read from that build, so no night gets a final "no PR" for commits the older tip cannot reach (Gitar on #507)', async () => {
  const runs = [...RUNS, {id: 910, head_sha: sha('d')}];
  const list = [stored('2026-11-08', 903), stored('2026-11-07', 910), stored('2026-11-06', 901)];   // 11/07 was re-run by hand after 11/08's night: its build is the newest
  const {nights: out} = await markNights(ENV, list, github({runs}).fetcher);
  const by = Object.fromEntries(out.map(night => [night.night, night]));
  assert.deepEqual(by['2026-11-07'].prs.map(pr => pr.n), [3650, null, 3631, 3624, 3592], 'everything merged between builds a and d, read from d');
  assert.deepEqual(by['2026-11-08'].prs, [], 'its build is older than its neighbour\'s: an empty window, a real "no PR"');
});
