// Guard: privacy — the daily harness upload reads CI artifacts with a workflow that holds the site's write secret: a record must be read as data (one file, 64 KB, its run id and url replaced by GitHub's own), a missing record is normal and invents nothing, and the plan states come from the plan file and PR titles only.
// The fixture is the shape of the first real run (4 Nov 2026, run 41932545228); nothing here calls GitHub or the site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {ARTIFACT, FILE, PLAN, chain, compute, fetchRuns, layers, parsePlan, recordOf} from '../../../../tools/harness-stats.mjs';

const plan = ['# Plan', '## PRs', '- not a row', '## Progress', '- [x] 1/7 This plan and the spec amendment', '- [ ] 2/7 Move `walls` into `tools/fixer/`', '- [ ] 3/7 Loop', '- [ ] web 1/3 One agent card per row', '- [ ] web 2/3 Agent harness page', ''].join('\n');
const pr = (number, title, extra = {}) => ({number, title, state: 'OPEN', mergedAt: null, createdAt: '2026-11-04T10:00:00Z', ...extra});
const now = new Date('2026-11-05T04:41:00Z');
const run = {id: 41932545228, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/41932545228'};
const record = {v: 1, workflow: 'ai-fixer', run_id: 1, url: 'https://evil.example/x', started: '2026-11-04T16:30:00Z', minutes: 4, source: 'linear', ref: 'JOB-271', round: 0, engine: 'codex/gpt-6.1-sol', turns: 3, calls: 3, tokens_in: 48124, tokens_out: 220,
  steps: [{n: 1, action: 'search'}, {n: 2, action: 'read'}, {n: 3, action: 'finish'}], verdict: 'needs-human', reason: '', changed_files: [], pr: null, stop: null, errors: []};

test('the plan rows come from the Progress list: the chain and the web group apart', () => {
  const {rows, web} = parsePlan(plan);
  assert.deepEqual(rows.map(row => [row.n, row.of, row.checked, row.name]), [[1, 7, true, 'This plan and the spec amendment'], [2, 7, false, 'Move walls into tools/fixer/'], [3, 7, false, 'Loop']]);
  assert.deepEqual(web.map(row => [row.n, row.of]), [[1, 3], [2, 3]]); assert.deepEqual(parsePlan('no progress here'), {rows: [], web: []});
});
test('a row is done when ticked or merged, in progress when a PR is open, and only a PR of its own N counts', () => {
  const {rows} = parsePlan(plan);
  const states = chain(rows, [pr(10, '[hm] 2/7 Move walls'), pr(11, '[hm] 3/8 Other plan, same row', {state: 'MERGED', mergedAt: '2026-11-04T12:00:00Z'}), pr(12, '[hm] 3/7 Loop', {createdAt: '2026-10-01T00:00:00Z'})], '2026-11-04');
  assert.deepEqual(states.map(row => [row.n, row.state, row.pr]), [[1, 'done', 0], [2, 'doing', 10], [3, 'next', 0]]);
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
});
test('runs without a record are skipped, a record is read from record.json only, an oversize or broken one is skipped, nothing else throws', () => {
  const runs = [{id: 1, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/1'}, {id: 2, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/2'}, {id: 3, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/3'}, {id: 4, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/4'}];
  const api = (...args) => (args[1].includes('/workflows/') ? runs : args[1].includes('/runs/1/') ? [] : [ARTIFACT]);
  const files = {2: JSON.stringify(record), 3: 'not json', 4: JSON.stringify({...record, reason: 'x'.repeat(70000)})};
  const download = (id, dir) => { fs.writeFileSync(`${dir}/${FILE}`, files[id]); fs.writeFileSync(`${dir}/other.txt`, 'ignored'); };
  const got = fetchRuns('jobadabra/jobadabra', now, api, download);
  assert.deepEqual(got.map(item => item.run_id), [2], 'run 1 has no artifact, 3 is not JSON, 4 is over 64 KB');
});
test('the body is one card for today: plan rows, the web group, layers, sources and the records', () => {
  const body = compute({plan, prs: [pr(10, '[hm] 2/7 Move walls')], webPrs: [pr(366, '[57] 1/3 One agent card per row', {state: 'MERGED', mergedAt: '2026-11-04T20:00:00Z'})], runs: [recordOf(record, run)]}, {has: () => false, count: () => 0}, now);
  const [day] = body.days;
  assert.equal(body.kind, 'harness'); assert.equal(day.day, '2026-11-05'); assert.deepEqual(day.plan.rows.map(row => row.state), ['done', 'doing', 'next']); assert.deepEqual(day.plan.web.map(row => [row.state, row.pr]), [['done', 366], ['next', 0]]);
  assert.equal(day.runs.length, 1); assert.equal(day.sources.length, 6); assert.ok(fs.existsSync(new URL(`../../../../${PLAN}`, import.meta.url)), 'the plan file the script reads exists');
});
