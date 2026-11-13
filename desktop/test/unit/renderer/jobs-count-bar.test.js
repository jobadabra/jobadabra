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
const {applicationStats, freshSince, jobCounts, statClick} = await import('../../../renderer/jobs-view.js');
const {countFor, soleFilter} = await import('../../../renderer/jobs-filters.js');
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

// df 2/2 (owner 13 Nov 2026: four cards): each card's number is the number of rows its click shows. The press does what pages/jobs.js does with a card: statClick -> the counter and the menu's filter.
const RUN = '2026-11-13T08:00:00Z';
const seen = (j, at) => ({...j, first_seen_at: at});
const cardJobs = [
  seen(job('unreviewed', 1), '2026-11-13T08:05:00Z'), seen(job('unreviewed', 2), '2026-11-13T08:06:00Z'), seen(job('unreviewed', 3), '2026-11-01T08:00:00Z'),
  seen(job('saved', 4), '2026-11-01T08:00:00Z'), seen(job('dismissed', 5), '2026-11-01T08:00:00Z'),
  {...job('applied', 6), stage: 'Applied'}, {...job('applied', 7), stage: 'Interviewing'}, {...job('applied', 8), stage: 'Rejected'},
  {...job('applied', 9), stage: 'Applying'},   // a form still being filled: not sent, so not on the Applied card nor in the menu's Applied
  {...job('applied', 10), stage: ''},   // marked Applied only on its match row: sent
];
function press(kind) {
  const next = statClick(kind, typeof jobsState.statFilter === 'string' ? jobsState.statFilter : null, soleFilter(jobsState.filters));
  jobsState.statFilter = next.stat; jobsState.filters = [next.filter];
  shared.allJobs = cardJobs; jobsState.lastJobsData = {jobs: cardJobs, total: cardJobs.length}; jobsState.lastRunStart = RUN;
  $('sort-by').value = 'best'; $('filter-text').value = '';
  renderJobs();
  return $('jobs-body').querySelectorAll('.job-row').length;
}
const cardCount = {
  total: () => jobCounts({jobs: cardJobs, total: cardJobs.length}).total,
  fresh: () => freshSince(cardJobs, RUN).length,
  applied: () => countFor(cardJobs, 'applied'),
  interviews: () => applicationStats(cardJobs).interviews,
};
for (const [kind, expected] of Object.entries({total: 5, fresh: 2, applied: 4, interviews: 1})) {
  test(`the ${kind} card counts ${expected}, and its click shows exactly ${expected} rows`, () => {
    jobsState.statFilter = null;
    assert.equal(cardCount[kind](), expected, 'the number on the card');
    assert.equal(press(kind), expected, 'the rows after the click');
  });
}
test('Applied is one rule: the card, the menu option and the line beside it agree (Applying stays out)', async () => {
  const {sentBreakdown} = await import('../../../renderer/jobs-view.js');
  const sent = cardJobs.filter(each => each.status === 'applied' && each.stage !== 'Applying');
  assert.equal(countFor(cardJobs, 'applied'), sent.length);
  assert.deepEqual(sentBreakdown(cardJobs), {waiting: 2, closed: 1}, 'waiting + in process (1) + closed = sent');
  assert.equal(countFor(cardJobs, 'view:applying'), 1, 'the form being filled is under Applying');
});
