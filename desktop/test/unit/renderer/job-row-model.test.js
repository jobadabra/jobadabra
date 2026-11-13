// What a Jobs row draws, for every filter of the list: the apply read and the score only for a job still waiting for your decision, a rejection in words,
// the sender's company for a reply with no employer, and "Find more jobs" only where a search adds rows (owner, 2 Nov 2026: a Windows tester's Inbound list).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FILTER_OPTIONS, findsMore, inFilters} from '../../../renderer/jobs-filters.js';
import {rejectionWords, rowModel} from '../../../renderer/job-row-model.js';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const base = {fit: null, company: '', via: '', source: 'Gmail', status: 'unreviewed', stage: null};
// The tester's two rows, and one of every other kind a list can hold.
const REPLY = {...base, url: 'g1', title: 'Reply from Fincruit', via: 'Fincruit', stage: 'Applied', status: 'applied', origin: 'Inbound'};
const REJECTED = {...base, url: 'g2', title: 'Audit Manager', company: 'PwC', stage: 'Rejected', status: 'applied', origin: 'Inbound', rejection: 'Unclear'};
const MATCH = {...base, url: 'm1', title: 'SRE', company: 'Acme', source: 'Job Pilotto app', origin: 'Outbound', fit: 80};
const UNSCORED = {...MATCH, url: 'm2', fit: null};
const SAVED = {...MATCH, url: 'm3', status: 'saved'};
const APPLIED = {...MATCH, url: 'm4', status: 'applied', stage: 'Applied', fit: null};
const DISMISSED = {...MATCH, url: 'm5', status: 'dismissed', stage: 'Dismissed'};
const LEAD = {...base, url: 'g3', title: 'Principal SRE', via: 'Huxley', stage: 'Recruiter lead', origin: 'Inbound'};
const ALL = [REPLY, REJECTED, MATCH, UNSCORED, SAVED, APPLIED, DISMISSED, LEAD];

test('under every filter, no row says "Not checked" or "Not scored" about a job that is not waiting for your decision', () => {
  let seen = 0;
  for (const option of FILTER_OPTIONS) {
    for (const job of ALL.filter(row => inFilters(row, [option.id], NOW))) {
      seen += 1;
      const row = rowModel(job);
      const waiting = job.origin !== 'Inbound' && (job.status === 'unreviewed' || job.status === 'saved');
      assert.equal(row.triage, waiting, `${option.label}: ${job.title} apply chip`);
      assert.equal(row.fit, waiting || job.fit != null, `${option.label}: ${job.title} score`);
      if (job.origin === 'Inbound' || job.status === 'applied') assert.equal(row.triage || (row.fit && job.fit == null), false, `${option.label}: ${job.title} says nothing about an apply read or a missing score`);
    }
  }
  assert.ok(seen >= ALL.length, 'every fixture is listed by at least one filter');
});

test('the tester\'s Inbound list: a reply names the sender\'s company, a rejection says why in words', () => {
  assert.deepEqual(rowModel(REPLY).who, {name: 'Fincruit', blank: false});
  assert.equal(rowModel(REJECTED).rejection, 'Rejection reason unclear');
  assert.equal(rejectionWords('Hard skills'), 'Why rejected: Hard skills');
  assert.deepEqual(rowModel({...REPLY, via: ''}).who, {name: 'N/A', blank: true}, 'no name at all: a blank avatar and N/A, never a "!" badge');
  assert.equal(rowModel(MATCH).who.name, 'Acme');
});

test('Find more jobs belongs to the lists of job matches only', () => {
  const finds = FILTER_OPTIONS.filter(option => findsMore([option.id])).map(option => option.id);
  assert.deepEqual(finds, ['open', 'all', 'everything']);
  assert.equal(findsMore(['inbound']), false);
  assert.equal(findsMore(['inbound', 'open']), true, 'several ticked: any list that finds more');
  // A counter sets the filters to "all" (jobs-view.js statClick): only New (the last run's matches) is a counter list a search adds to (#3026, Gitar; df 2/2: Total matches and Applied are menu lists now).
  for (const counter of ['waiting', 'interviews', 'closed', 'stuck', {urls: new Set()}]) assert.equal(findsMore(['all'], counter), false, JSON.stringify(counter));
  assert.equal(findsMore(['all'], 'fresh'), true, 'fresh');
});
