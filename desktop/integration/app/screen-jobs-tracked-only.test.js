/* global document */
// Jobs, layer 2: a list of tracked jobs and no match (owner, 4 Nov 2026: "Find jobs (this big card) should not appear if there are more than 0 jobs").
// The default list says what is true, not "No job matches this filter" to someone who set no filter. Why here and not the no-search state itself: the demo hides
// every job until a search ran (lib/demo-search.js), so that state is proved on the model, test/unit/renderer/job-counts.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const row = {location: '', work_mode: '', posted_at: '2099-01-01', first_seen_at: '2099-01-01', reason: '', skills: [], notion_url: '', origin: 'Outbound', fit: null, status: 'applied', stage: 'Applied'};
const JOBS = [1, 2, 3].map(id => ({...row, id, code: `t${id}`, title: `Nurse ${id}`, company: `Clinic ${id}`, url: `https://jobs.tracked-list.example/${id}`, rank: id}));

test('a list with no match says so in words that fit the default list, and the tiles still hold the jobs', {skip: needsElectron.skip}, () => {
  const {result} = probeWindow({files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=jobs]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    await kit.until(() => document.body.dataset.findCard === 'none', 'the small Find jobs card drawn');   // set after draw(), and only once the list was read
    await kit.until(() => document.querySelector('#jobs-empty:not([hidden])'), 'the words under the list');   // index.html holds other words while it is hidden
    const empty = document.getElementById('jobs-empty').textContent.trim();
    const small = {title: document.querySelector('#find-card .find-title')?.textContent.trim(), lead: document.querySelector('#find-card .find-lead')?.textContent.trim(), shown: !document.getElementById('find-card').hidden};
    document.querySelector('[data-stat=applied]').click();
    await kit.until(() => document.querySelectorAll('article.job-row').length === 3, 'the three applications');
    return {empty, small, card: !document.getElementById('find-card').hidden};
  }});
  assert.equal(result.empty, 'No open jobs right now.');   // Why (13 Nov 2026, owner: "I should always start as the default with total matches"): the app opens on All matches, whose empty list says there is no open job, not "No new matches yet"
  assert.deepEqual(result.small, {title: 'Find more jobs', lead: 'Reads your employers and job boards again, and adds what is new.', shown: true}, 'the small card, in its own words (owner, 5 Nov 2026)');
  assert.equal(result.card, false, 'under Applied no Find jobs card');
});
