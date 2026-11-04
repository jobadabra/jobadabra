// gv's Google film (4 Nov 2026): under the Inbound tile, typing a recruiter's name in the Jobs search box gave 0 rows. The box matched title, company, place and link only; an
// opportunity that found you carries its recruiter in `contact` ("Name · email") and its agency in `via` (its employer is often hidden: company empty), and the row shows them.
// Scenario: the Inbound list, then a search for the recruiter's name, the agency, the address. Positive control: the old words (title, company) still find the same rows.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matches} from '../../../renderer/filter.js';
import {byFilter} from '../../../renderer/jobs-view.js';

const row = {location: '', work_mode: '', status: 'applied', stage: 'Recruiter lead', url: '', via: '', contact: ''};
const JOBS = [
  {...row, title: 'Principal SRE', company: '', via: 'Huxley', contact: 'Jaya Patel · jaya@huxley.test', origin: 'Inbound', url: 'https://mail.example/inbound/1'},
  {...row, title: 'Audit Manager', company: 'PwC', contact: 'Marta Keller · marta@fincruit.com', via: 'Fincruit', origin: 'Inbound', url: 'https://mail.example/inbound/2'},
  {...row, title: 'Site Reliability Engineer', company: 'Acme', location: 'Zurich', origin: 'Outbound', stage: 'Saved', status: 'saved', url: 'https://jobs.example/3'},
];
const found = text => byFilter(JOBS, 'inbound').filter(job => matches(job, text)).map(job => job.title);

test('under Inbound, the recruiter\'s name finds their opportunity', () => {
  assert.deepEqual(found('Jaya'), ['Principal SRE'], 'a first name');
  assert.deepEqual(found('keller'), ['Audit Manager'], 'a surname, any case');
  assert.deepEqual(found('Jaya Patel'), ['Principal SRE'], 'the whole name');
});

test('the agency and the address find it too (an opportunity whose employer is hidden has no company)', () => {
  assert.deepEqual(found('huxley'), ['Principal SRE'], 'the agency (Via)');
  assert.deepEqual(found('marta@fincruit'), ['Audit Manager'], 'the address');
});

test('the words that always worked still do, and a name nobody wrote from finds nothing', () => {
  assert.deepEqual(found('audit'), ['Audit Manager'], 'positive control: title');
  assert.deepEqual(found('pwc'), ['Audit Manager'], 'positive control: company');
  assert.deepEqual(found('Zelda'), [], 'no one by that name');
});
