// The Jobs list bar names the set it counts (#3377, owner 7 Nov 2026, "Words say it"): the header's "13 matches" counts saved and dismissed matches, the New matches list holds 12.
// Drives the real renderer: the bar under the header reads "12 new of 13 matches", and stays the plain count where there is nothing to explain.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();   // the imported pages own background clocks
const doc = globalThis.document, found = doc.getElementById.bind(doc);
doc.getElementById = id => {
  let node = found(id);
  if (!node) {
    node = doc.createElement('div'); node.id = id; doc.body.append(node);
    if (id.startsWith('nav-')) { const dot = doc.createElement('span'); dot.className = 'nav-dot'; node.append(dot); }
  }
  return node;
};
globalThis.window.pilot = new Proxy({}, {get: () => async () => null});
const {shared} = await import('../../../renderer/pages/shared.js');
const {jobsState} = await import('../../../renderer/pages/jobs-state.js');
const {renderJobs} = await import('../../../renderer/pages/jobs-render.js');
const {DEFAULT_FILTERS} = await import('../../../renderer/jobs-filters.js');
const {jobCounts} = await import('../../../renderer/jobs-view.js');
const $ = id => doc.getElementById(id);

const job = (status, i) => ({url: `https://jobs.example.test/${i}`, title: `Role ${i}`, company: `Company ${i}`, location: 'Berlin', work_mode: 'remote', stage: 'Kit ready', status, fit: 80, first_seen_at: '2026-01-01', skills: []});
function draw(jobs, {filters = ['open'], statFilter = null} = {}) {
  shared.allJobs = jobs; jobsState.lastJobsData = {jobs, total: jobs.length};
  if (filters) jobsState.filters = filters;   // null: leave the state the app starts with
  jobsState.statFilter = statFilter;
  $('sort-by').value = 'best'; $('filter-text').value = '';
  renderJobs();
  return $('jobs-count').textContent;
}
// Why (13 Nov 2026, owner: "when I open the app, it filters for latest/new matches... which shows me 0 jobs. I should always start as the default with \"total matches\""): the list opens
// on the jobs the Total matches counter counts, not on the unreviewed ones, so a person who looked at every job never opens an empty list. Runs first: it reads the state a fresh app starts with.
test('the app opens on every match: all reviewed, the first list holds the Total matches count', () => {
  const reviewed = [job('saved', 1), job('saved', 2), job('dismissed', 3), job('applied', 4)];
  assert.deepEqual(jobsState.filters, DEFAULT_FILTERS, 'one source: the state starts on the menu default');
  const bar = draw(reviewed, {filters: null});
  const total = jobCounts({jobs: reviewed, total: reviewed.length}).total;
  assert.equal(total, 3);
  assert.equal($('jobs-body').querySelectorAll('.job-row').length, total, 'rows = the Total matches counter');
  assert.equal(bar, '3 jobs');
});
const twelve = Array.from({length: 12}, (_, i) => job('unreviewed', i));

test('New matches over a saved one: the bar reads "12 new of 13 matches", the rows are the 12', () => {
  assert.equal(draw([...twelve, job('saved', 90)]), '12 new of 13 matches');
  assert.equal($('jobs-body').querySelectorAll('.job-row').length, 12);
});
test('a dismissed match is explained the same way; with nothing else the bar stays the plain count', () => {
  assert.equal(draw([...twelve, job('dismissed', 91)]), '12 new of 13 matches');
  assert.equal(draw(twelve), '12 jobs');
});
test('All matches keeps its own count: 13 jobs for 13 rows', () => {
  assert.equal(draw([...twelve, job('saved', 90)], {filters: ['all']}), '13 jobs');
});
