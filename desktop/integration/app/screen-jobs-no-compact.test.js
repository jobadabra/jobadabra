/* global document, localStorage */
// Jobs, layer 2: the list has one density (owner, 5 Nov 2026: "compact mode doesn't make any sense. Just crowds all the content on the left, leaving all the empty space on the right";
// asked what should happen to it, he picked "Remove Compact"). The toolbar has List | Board and no density switch, and a computer that had chosen Compact before
// shows the same columned list as everyone else (company, place and status in their own columns, the column titles above).
// The app's window on fictional rows, no Notion, no AI.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const row = {location: 'Zurich', work_mode: 'Hybrid', posted_at: '2099-01-01', first_seen_at: '2099-01-01', reason: 'A fit.', skills: [], notion_url: '', origin: 'Outbound', fit: 82, status: 'unreviewed', stage: null};
const JOBS = [1, 2].map(id => ({...row, id, code: `n${id}`, title: `Engineer ${id}`, company: `Acme ${id}`, url: `https://jobs.no-compact.example/${id}`, rank: id}));

test('no Compact switch, and a stored "compact" choice draws the columned list', {skip: needsElectron.skip}, () => {
  const {result} = probeWindow({files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=jobs]:not([hidden])'), 'the menu');
    localStorage.setItem('jobsDensity', 'compact');   // what a computer that chose Compact kept
  }, after: async kit => {
    await kit.go('jobs');
    await kit.until(() => document.querySelectorAll('article.job-row').length === 2, 'the two job rows');
    const shown = selector => { const node = document.querySelector(selector); return !!node && node.getClientRects().length > 0; };
    return {
      switches: [...document.querySelectorAll('.list-right button')].map(button => button.textContent.trim()),
      compactClass: document.getElementById('jobs-body').classList.contains('compact'),
      headShown: shown('#jobs-head'), companyShown: shown('.job-row .company'), placeShown: shown('.job-row .place'),
    };
  }});
  assert.deepEqual(result.switches, ['List', 'Board'], 'the toolbar has the List | Board switch and no density switch');
  assert.equal(result.compactClass, false, 'a stored "compact" does not turn the list compact');
  assert.deepEqual([result.headShown, result.companyShown, result.placeShown], [true, true, true], 'the column titles, company and place are drawn');
});
