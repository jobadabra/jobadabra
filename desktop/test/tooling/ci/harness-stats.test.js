// Guard: privacy — the daily harness upload reads CI artifacts with a workflow that holds the site's write secret: a record must be read as data (one file, 64 KB, its run id and url replaced by GitHub's own), a missing record is normal and invents nothing, and the plan states come from the plan file and PR titles only.
// The fixture is the shape of the first real run (4 Nov 2026, run 41932545228); nothing here calls GitHub or the site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ARTIFACT, FILE, PLAN, SOURCES, chain, compute, fetchRuns, layers, parsePlan, phasesOf, readKeys, recordOf} from '../../../../tools/harness-stats.mjs';

const plan = ['# Plan', '## PRs', '- not a row', '## Progress', '- [x] 1/7 This plan and the spec amendment', '- [ ] 2/7 Move `walls` into `tools/fixer/`', '- [ ] 3/7 Loop', '- [ ] web 1/3 One agent card per row', '- [ ] web 2/3 Agent harness page', '', '## Later', '- [ ] 1/9 A checklist of something else', ''].join('\n');
const pr = (number, title, extra = {}) => ({number, title, body: `Plan: \`${PLAN}\``, state: 'OPEN', mergedAt: null, createdAt: '2026-11-04T10:00:00Z', ...extra});
const now = new Date('2026-11-05T04:41:00Z');
const run = {id: 41932545228, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/41932545228'};
const record = {v: 1, workflow: 'ai-fixer', run_id: 1, url: 'https://evil.example/x', started: '2026-11-04T16:30:00Z', minutes: 4, source: 'linear', ref: 'JOB-271', round: 0, engine: 'codex/gpt-6.1-sol', turns: 3, calls: 3, tokens_in: 48124, tokens_out: 220,
  steps: [{n: 1, action: 'search'}, {n: 2, action: 'read'}, {n: 3, action: 'finish'}], verdict: 'needs-human', reason: '', changed_files: [], pr: null, stop: null, errors: []};

test('the plan rows come from the Progress list: the chain and the web group apart', () => {
  const {rows, web} = parsePlan(plan);
  assert.deepEqual(rows.map(row => [row.n, row.of, row.checked, row.name]), [[1, 7, true, 'This plan and the spec amendment'], [2, 7, false, 'Move walls into tools/fixer/'], [3, 7, false, 'Loop']]);
  assert.equal(rows.length, 3, 'a checklist after the next heading is not a row'); assert.deepEqual(web.map(row => [row.n, row.of]), [[1, 3], [2, 3]]); assert.deepEqual(parsePlan('no progress here'), {rows: [], web: []});
});
test('a row is done when ticked or merged, in progress when a PR is open, and only a PR of its own N counts', () => {
  const {rows} = parsePlan(plan);
  const states = chain(rows, [pr(10, '[hm] 2/7 Move walls'), pr(11, '[hm] 3/8 Other plan, same row', {state: 'MERGED', mergedAt: '2026-11-04T12:00:00Z'}), pr(12, '[hm] 3/7 Loop', {createdAt: '2026-10-01T00:00:00Z'})], '2026-11-04');
  assert.deepEqual(states.map(row => [row.n, row.state, row.pr]), [[1, 'done', 0], [2, 'doing', 10], [3, 'next', 0]]);
  assert.deepEqual(chain(rows, [{...pr(30, '[hm] 2/7 From another plan'), body: 'Plan: `docs/superpowers/plans/other.md`'}], '2026-11-04').map(row => row.state), ['done', 'next', 'next'], 'a PR whose body names another plan does not move a row');
  const merged = chain(rows, [pr(20, '[57] [x] 3/7 Loop', {state: 'MERGED', mergedAt: '2026-11-04T12:00:00Z'})], '2026-11-04');
  assert.deepEqual([merged[2].state, merged[2].pr], ['done', 20], 'a second tag in the title still matches');
});
test('layers and sources are file facts: "built" is a file that exists, nothing about a key', () => {
  const have = new Set(['docs/map/index.md', 'tools/context/sources/linear.mjs', 'tools/context/sources/posthog.mjs']);
  const out = layers(file => have.has(file), (dir, suffix) => ({'docs/map': 4, 'docs/superpowers/specs': 70, 'docs/rules': 11, '.claude/skills': 17}[dir]));
  assert.deepEqual(out.layers.map(layer => [layer.id, layer.present, layer.note]), [['L0', true, 'docs/map/index.md'], ['L1', true, '3 hubs'], ['L2', true, '70 specs, 11 rules, 17 skills'], ['L3', true, '2 of 6 fetchers']]);
  assert.deepEqual(out.sources.map(source => [source.name, source.built]), [['Linear', true], ['Sentry', false], ['GitHub', false], ['PostHog', true], ['Cloudflare', false], ['Notion', false]]);
  assert.equal(layers(() => false, () => 0).layers[0].present, false);
});
test("a record keeps GitHub's run id and url, whatever the artifact says; a non-object is refused", () => {
  const out = recordOf(record, run);
  assert.equal(out.run_id, 41932545228); assert.equal(out.url, run.html_url); assert.equal(out.verdict, 'needs-human');
  for (const bad of [null, 'text', 7, [record]]) assert.equal(recordOf(bad, run), null);
  const deep = JSON.parse(`{"v":1,"extra":${'['.repeat(20000)}${']'.repeat(20000)},"reason":"${'r'.repeat(5000)}","errors":["a",{"x":1}],"steps":[{"n":1,"action":"read","z":2}],"pr":"7"}`);
  const bounded = recordOf(deep, run);
  assert.ok(!('extra' in bounded) && JSON.stringify(bounded).length < 2000, 'unknown keys and nesting never leave the script'); assert.equal(bounded.reason.length, 400); assert.equal(bounded.pr, null); assert.deepEqual(bounded.steps, [{n: 1, action: 'read', s: 0, ok: true, refusal: '', path: '', tout: 0}], 'a step is a copy of its known fields: seconds, refused or not, tokens written (5/7)');
});
test('runs without a record are skipped, a record is read from record.json only, an oversize or broken one is skipped, nothing else throws', () => {
  const runs = [{id: 1, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/1'}, {id: 2, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/2'}, {id: 3, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/3'}, {id: 4, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/4'}];
  const jobs = [{name: 'guard', started_at: '2026-11-05T10:00:20Z', completed_at: '2026-11-05T10:00:50Z'}, {name: 'fix', started_at: '2026-11-05T10:01:00Z', completed_at: '2026-11-05T10:07:00Z'}];
  const api = (...args) => (args[1].includes('/workflows/') ? runs.map(item => ({...item, run_started_at: '2026-11-05T09:59:00Z'})) : args[1].includes('/jobs') ? jobs : args[1].includes('/runs/1/') ? [] : [ARTIFACT]);
  const files = {2: JSON.stringify(record), 3: 'not json', 4: JSON.stringify({...record, reason: 'x'.repeat(70000)})};
  const download = (id, dir) => { fs.writeFileSync(`${dir}/${FILE}`, files[id]); fs.writeFileSync(`${dir}/other.txt`, 'ignored'); };
  const got = fetchRuns('jobadabra/jobadabra', now, api, download);
  assert.deepEqual(got.map(item => item.run_id), [2], 'run 1 has no artifact, 3 is not JSON, 4 is over 64 KB');
  assert.deepEqual(got[0].phases, [{name: 'queue', s: 80}, {name: 'guard', s: 30}, {name: 'fix', s: 360}], "phases come from GitHub's job times, not from the artifact");
  assert.throws(() => fetchRuns('jobadabra/jobadabra', now, () => { throw new Error('HTTP 403 rate limit'); }, download), /403/, 'a gh failure is not "no data"');
  assert.throws(() => fetchRuns('jobadabra/jobadabra', now, api, () => { throw new Error('HTTP 502'); }), /502/, 'a failed download is not "no record"');
});
test('the body stays under the site limit: the oldest runs go first and the plan always arrives', () => {
  const big = Array.from({length: 60}, (_, i) => recordOf({...record, reason: 'r'.repeat(400), errors: Array(5).fill('e'.repeat(200)), changed_files: Array(20).fill('f'.repeat(120)), steps: Array(30).fill({n: 1, action: 'edit', s: 99.9, ok: false, path: 'p'.repeat(60), tout: 12345})}, {id: 100 + i, html_url: `https://github.com/jobadabra/jobadabra/actions/runs/${100 + i}`}));
  // Why (5 Nov 2026, [hm] 5/7 steps; owner: "high level details/steps/paths"): a step now carries seconds, a path and tokens, so 60 records at EVERY maximum (30 steps with 60-character paths) no longer all fit: the oldest go first, at least 40 stay.
  // A real run (12 steps, ordinary paths, a short reason) is a few KB: all 60 of those fit the real limit.
  assert.ok(compute({plan, runs: big}, {has: () => false, count: () => 0}, now).days[0].runs.length >= 40, 'the worst records: the newest 40 at least fit the real limit');
  const usual = Array.from({length: 60}, (_, i) => recordOf({...record, reason: 'r'.repeat(150), errors: ['e'.repeat(80)], changed_files: ['src/a.py', 'tests/a.py'], steps: Array(12).fill({n: 1, action: 'edit', s: 4.2, ok: true, path: 'desktop/renderer/a.js', tout: 300})}, {id: 500 + i, html_url: `https://github.com/jobadabra/jobadabra/actions/runs/${500 + i}`}));
  assert.equal(compute({plan, runs: usual}, {has: () => false, count: () => 0}, now).days[0].runs.length, 60, 'ordinary records: all 60 fit');
  const body = compute({plan, runs: big}, {has: () => false, count: () => 0}, now, 100000);
  assert.ok(JSON.stringify(body).length <= 100000); assert.ok(body.days[0].runs.length < 60 && body.days[0].runs.length > 5); assert.equal(body.days[0].runs[0].run_id, 100, 'the newest stay'); assert.equal(body.days[0].plan.rows.length, 3);
});
test('the workflow gives the site key to the store step only, never to the step that reads the artifacts, and never checks out the fixer run', () => {
  const yml = fs.readFileSync(new URL('../../../../.github/workflows/harness-stats.yml', import.meta.url), 'utf8');
  const [head, keysStep, readStep, storeStep] = yml.split(/\n      - name: /);
  // The key-state step (5 Nov 2026) holds the five READ keys only to test "non-empty": no repo code, no node, no artifact, never the site key; the step that parses artifacts holds no secret at all.
  assert.match(keysStep, /^Note which read keys are stored/); assert.ok(!/SELFHEAL_PUBLISH_KEY|\bnode\b|download|gh run|uses:/.test(keysStep), 'the key-state step only tests booleans');
  assert.deepEqual([...keysStep.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]).sort(), ['CLOUDFLARE_READ_TOKEN', 'LINEAR_READ_KEY', 'NOTION_READ_TOKEN', 'POSTHOG_READ_KEY', 'SENTRY_READ_TOKEN']);
  assert.ok(!/secrets\./.test(readStep) && !/secrets\./.test(head), 'the step that reads the artifacts holds no secret');
  assert.ok(!/SELFHEAL_PUBLISH_KEY: \$\{\{/.test(head) && !/SELFHEAL_PUBLISH_KEY: \$\{\{/.test(readStep), 'the read step has no secret'); assert.match(storeStep, /SELFHEAL_PUBLISH_KEY: \$\{\{ secrets\.SELFHEAL_PUBLISH_KEY \}\}/);
  assert.match(head, /\n    if: github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)\n/, 'a by-hand start on another branch never holds the site key');
  assert.match(storeStep, /case "\$code" in 200\).*400\).*exit 1/s, 'only 400 is a notice: a refused key or a server error is red');
  assert.ok(!/head_branch|head_sha|workflow_run\.(head|pull)|inputs\./.test(yml.replace(/^#.*$/gm, '')), 'nothing from the triggering run reaches a command or a checkout');
});
test('a source is "key set" only when the trusted step saw its secret non-empty; an unreported key claims nothing (owner, 5 Nov 2026: PostHog showed green with no key)', () => {
  const all = new Set(SOURCES.map(source => source[1]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-keys-'));
  const file = path.join(dir, 'keys.json');
  fs.writeFileSync(file, JSON.stringify({LINEAR_READ_KEY: true, POSTHOG_READ_KEY: false, NOTION_READ_TOKEN: 'yes', EVIL: true}));
  const keys = readKeys(file);
  assert.deepEqual(keys, {LINEAR_READ_KEY: true, POSTHOG_READ_KEY: false}, 'only booleans for the known secret names survive');
  const state = layers(f => all.has(f), () => 0, keys).sources.map(source => [source.name, source.key]);
  assert.deepEqual(state, [['Linear', 'set'], ['Sentry', ''], ['GitHub', 'set'], ['PostHog', 'missing'], ['Cloudflare', ''], ['Notion', '']]);
  assert.deepEqual(readKeys(path.join(dir, 'nope.json')), {}, 'a missing file means "not reported", never "missing"');
  assert.equal(layers(() => false, () => 0, keys).sources.every(source => source.key === ''), true, 'a source with no fetcher has no key state');
});

test('the body is one card for today: plan rows, the web group, layers, sources and the records', () => {
  const body = compute({plan, prs: [pr(10, '[hm] 2/7 Move walls')], webPrs: [pr(366, '[57] 1/3 One agent card per row', {state: 'MERGED', mergedAt: '2026-11-04T20:00:00Z'})], runs: [recordOf(record, run)]}, {has: () => false, count: () => 0}, now);
  const [day] = body.days;
  assert.equal(body.kind, 'harness'); assert.equal(day.day, '2026-11-05'); assert.deepEqual(day.plan.rows.map(row => row.state), ['done', 'doing', 'next']); assert.deepEqual(day.plan.web.map(row => [row.state, row.pr]), [['done', 366], ['next', 0]]);
  assert.equal(day.runs.length, 1); assert.equal(day.sources.length, 6); assert.ok(fs.existsSync(new URL(`../../../../${PLAN}`, import.meta.url)), 'the plan file the script reads exists');
});

test('phases: the queue, then each known job in workflow order; a skipped job, a missing end or a name we do not know is left out', () => {
  const at = minute => `2026-11-05T10:${String(minute).padStart(2, '0')}:00Z`;
  const jobs = [{name: 'fix', started_at: at(2), completed_at: at(8)}, {name: 'guard', started_at: at(1), completed_at: at(2)}, {name: 'prove', started_at: null, completed_at: null}, {name: 'publish', started_at: at(8), completed_at: ''}, {name: 'evil <b>', started_at: at(1), completed_at: at(9)}];
  assert.deepEqual(phasesOf(jobs, at(0)), [{name: 'queue', s: 60}, {name: 'guard', s: 60}, {name: 'fix', s: 360}]);
  assert.deepEqual([phasesOf([], at(0)), phasesOf(null, at(0)), phasesOf(jobs, 'x')], [[], [], []]);
  assert.equal(phasesOf([{name: 'guard', started_at: at(1), completed_at: at(2)}], at(5))[0].s, 0, 'never negative');
});
