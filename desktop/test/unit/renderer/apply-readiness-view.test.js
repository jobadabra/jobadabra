// A job's apply readiness in one model (owner, 13 Nov 2026, via the coordinator: "let's add a new action on the job to fulffull the apply readiness", "One action, changes with state (Recommended)";
// "on the job drawer, on the "Application" tab, beside these. I should see a tab with Apply readiness and with Account/Credentials"): the ⋯ menu's item follows the stored check, and the drawer's
// two new parts read the same check. renderer/apply-readiness-view.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountOf, menuItemOf, readinessOf} from '../../../renderer/apply-readiness-view.js';

const clean = {eligible: true, captcha: false, login: false, accountCreation: false};
const READS = {
  notChecked: null,
  login: {...clean, login: true, simple: false, why: 'login'},
  account: {...clean, accountCreation: true, simple: false, why: 'account'},
  details: {...clean, simple: true, questions: [{label: 'Salary'}], match: {missing: [{kind: 'detail', name: 'Salary expectation'}], unjudged: 0}},
  ready: {...clean, simple: true, questions: [], match: {missing: [], unjudged: 0}},
  ineligible: {...clean, eligible: false},
};

test('the ⋯ menu item follows the stored check: Check, then Fix what\'s missing while it needs you, then Check again', () => {
  assert.deepEqual(menuItemOf(READS.notChecked), {action: 'check', label: 'Check apply readiness'});
  for (const name of ['login', 'account', 'details']) assert.deepEqual(menuItemOf(READS[name]), {action: 'fix', label: "Fix what's missing"}, name);
  assert.deepEqual(menuItemOf(READS.ready), {action: 'check', label: 'Check again'});
  assert.deepEqual(menuItemOf(READS.ineligible), {action: 'check', label: 'Check again'});
});

test('Apply readiness says what the check found and lists what is missing, from the same read', () => {
  assert.deepEqual(readinessOf(READS.notChecked), {checked: false, chip: {label: 'Not checked', tone: 'neutral'}, found: '', missing: [], button: 'Check apply readiness'});
  const login = readinessOf(READS.login);
  assert.equal(login.chip.label, 'Needs you');
  assert.deepEqual(login.missing, ['Sign in on the employer\'s site']);
  assert.equal(login.button, 'Check again');
  assert.deepEqual(readinessOf(READS.account).missing, ['An account on the employer\'s site']);
  assert.deepEqual(readinessOf(READS.details).missing, ['Salary expectation']);
  assert.deepEqual(readinessOf(READS.ready).missing, []);
  assert.ok(readinessOf(READS.ready).found, 'a ready job still says what the check found');
});

test('Account / Credentials: what the site asks, and the saved sign-in by the job\'s link, then its host, then its company; never a password', () => {
  const job = {url: 'https://jobs.migros.ch/x', company: 'Migros'};
  const rows = [{host: 'career2.successfactors.eu', email: 'you@example.com', job: 'https://jobs.migros.ch/x', state: 'confirmed', companies: ['Migros'], password: 'never-shown'},
    {host: 'jobs.other.example', email: 'other@example.com', job: '', companies: []}];
  const seen = accountOf(job, READS.login, rows);
  assert.deepEqual(seen, {need: 'sign-in', saved: {host: 'career2.successfactors.eu', email: 'you@example.com', state: 'confirmed'}});
  assert.equal(JSON.stringify(seen).includes('never-shown'), false, 'no password in the model');
  assert.deepEqual(accountOf({url: 'https://jobs.other.example/role/7', company: 'Other'}, READS.account, rows).saved?.host, 'jobs.other.example', 'by host');
  assert.deepEqual(accountOf({url: 'https://careers.example/1', company: 'migros '}, READS.ready, rows).saved?.host, 'career2.successfactors.eu', 'by company, any case');
  assert.deepEqual(accountOf({url: 'https://nowhere.example/1', company: 'Nobody'}, READS.ready, rows), {need: 'none', saved: null});
  assert.deepEqual(accountOf(job, READS.notChecked, []), {need: 'unknown', saved: null});
});
