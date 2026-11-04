// Layer 3 (Node + the real engine + this Mac's real SQLite store, no window): a strategy change keeps the old scores and asks for a re-score (owner, 2 Nov 2026: "I don't think we should clear
// all the scoring instantly, but rather show a stale/warning message ... a very visible call to action on the jobs list to rescore ... but still, there should be the old scored").
// The scenario: jobs found and scored by a real Find jobs run (the stand-in AI answers), then the places saved by the app's own writer (lib/strategy-settings.js keepLocally), then:
//   (a) the Jobs read still carries every fit, each scored job marked `stale` (src/desktop_strategy.py mark_outdated);
//   (b) the Jobs call to action's count (`outdated.count` of the jobs read) is Strategy's `outdated.count`, from the same engine function;
//   (d) Re-score (the app's rescore-outdated command, then the search it starts) replaces the fits with new ones and the marks go.
// The window side (c: Find jobs with stale scores asks "Score first" and starts no search) is desktop/integration/app/screen-jobs-rescore.test.js; the words and the one state owner are test/unit/renderer/rescore-call.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {startEngineKit} from './engine-kit.mjs';

const E2E = new URL('../../e2e/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let kit, strategy, pipelineRun;
before(async () => {
  kit = await startEngineKit({answers: 'jobs'});
  strategy = await import('../../lib/strategy-settings.js');
  pipelineRun = await import('../../lib/pipeline-run.js');
});
after(async () => { await kit?.close(); });

const readJobs = () => kit.tasks.jobs(kit.storage, 200);
const engine = async (...args) => {
  const {code, stdout} = await pipelineRun.run(kit.storage, ['src.desktop', ...args], () => {}, {JOBADABRA_STORE: 'sqlite', JOBADABRA_FOLLOW_APP: '0'});
  assert.equal(code, 0, `src.desktop ${args.join(' ')} failed`);
  return JSON.parse(stdout.trim().split('\n').pop());
};
const scored = list => list.jobs.filter(job => job.fit != null);
const readSearch = () => JSON.parse(fs.readFileSync(path.join(kit.profile, 'config', 'search.json'), 'utf8'));
// The app's own writer for the places (lib/strategy-settings.js keepLocally: the window's save on this Mac's store).
const savePlaces = top => strategy.keepLocally(kit.storage, {profile_markdown: 'Placeholder.', answers_markdown: 'Placeholder.', contact: {}, search: {locations: {...(readSearch().locations || {}), top_tier: top}}, preferences: null}, ['search']);
let before_;

test('a Find jobs run scores some jobs, and none is marked stale yet', async () => {
  const acme = JSON.parse(fs.readFileSync(path.join(E2E, 'fixtures', 'feeds', 'acme.json'), 'utf8'));
  ['Senior Site Reliability Engineer, Payments', 'Staff Platform Engineer, Observability'].forEach((title, i) => acme.jobs.push({id: 1100 + i, title, location: {name: 'Zurich, Switzerland'}, absolute_url: `https://boards.e2e.test/job/${1100 + i}`, updated_at: '2026-10-02T09:00:00Z',
    content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in Zurich, English working language.</p>`}));
  fs.writeFileSync(path.join(kit.feeds, 'acme.json'), JSON.stringify(acme));
  savePlaces(['Zurich']);   // a score records the places it was made with (src/ai/locations.py fingerprint); none set, none to compare later
  const done = await kit.runTask('refresh', 'run', 'you');
  assert.ok(done.ok !== false, `the search did not end: ${JSON.stringify(done).slice(0, 300)}`);
  before_ = await readJobs();
  assert.ok(scored(before_).length > 0, `no job was scored (rows: ${before_.jobs.map(job => `${job.title}=${job.fit}`).join('; ')})`);
  assert.deepEqual(before_.jobs.filter(job => job.stale), [], 'nothing is from a previous strategy yet');
  assert.equal(before_.outdated.count, 0);
});

test('(a)(b) a places change keeps every fit on the Jobs list, marks the old ones, and the call\'s count is Strategy\'s', async () => {
  savePlaces(['Zurich', 'Lisbon']);
  const after_ = await readJobs();
  const fitsBefore = Object.fromEntries(scored(before_).map(job => [job.id, job.fit]));
  const fitsAfter = Object.fromEntries(scored(after_).map(job => [job.id, job.fit]));
  assert.deepEqual(fitsAfter, fitsBefore, 'the old fits are still on the list, none cleared by the change');
  const marked = after_.jobs.filter(job => job.stale && job.fit != null);
  const seen = await engine('strategy');
  assert.ok(marked.length > 0, `no scored job is marked as scored with the previous strategy (outdated ${JSON.stringify(after_.outdated)}; strategy says previous ${seen.previous}, previous_locations ${seen.previous_locations}; places now ${JSON.stringify(readSearch().locations)}; rows ${JSON.stringify(after_.jobs.map(job => [job.id, job.fit, job.stale]))})`);
  assert.equal(after_.outdated.count, (await engine('strategy')).outdated.count, 'the Jobs call to action and Strategy\'s notice count differently');
  assert.ok(after_.outdated.count >= marked.length);
});

test('(c) a Find jobs press does not re-score the listed jobs: their old scores stay marked until Re-score (owner, 3 Nov 2026)', async () => {
  const marked = (await readJobs()).outdated.count;
  assert.ok(marked > 0, 'the places change left old scores to protect');
  const byUrl = list => Object.fromEntries(scored(list).map(job => [job.url, job.fit]));   // a store row has no job id (src/desktop_jobs.py): the url is its key
  await engine('rescore-outdated');   // the person asked for new scores (input_hash ''): before this change the next Find jobs scored them; now only the Re-score run does
  const fitsBefore = byUrl(await readJobs());
  const done = await kit.runTask('refresh', 'run', 'you');
  assert.ok(done.ok !== false, `the search did not end: ${JSON.stringify(done).slice(0, 300)}`);
  const now = await readJobs();
  for (const [url, fit] of Object.entries(byUrl(now))) if (url in fitsBefore) assert.equal(fit, fitsBefore[url], `${url} was re-scored by Find jobs`);
  assert.equal(now.outdated.count, marked, 'Find jobs replaced an old score (the count fell) or made new ones');
});

test('(d) Re-score replaces the old fits and the marks go', async () => {
  const outdated = (await readJobs()).outdated.count;
  const queued = (await engine('rescore-outdated')).queued;
  assert.equal(queued, outdated, 'Re-score queues exactly what the call counted');
  const done = await kit.runTask('rescore', 'you', {note: `Re-scoring ${queued} older scores`});   // its own run, not a search
  assert.ok(done.ok !== false, `the re-scoring search did not end: ${JSON.stringify(done).slice(0, 300)}`);
  const after_ = await readJobs();
  assert.deepEqual(after_.jobs.filter(job => job.stale), [], 'a mark is left after the new scores arrived');
  assert.equal(after_.outdated.count, 0, 'the call to action still counts jobs');
  assert.ok(scored(after_).length >= scored(before_).length, 'a re-score lost a fit');
});
