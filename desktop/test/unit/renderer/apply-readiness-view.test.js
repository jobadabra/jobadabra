// A job's apply readiness in one model (owner, 13 Nov 2026, via the coordinator: "let's add a new action on the job to fulffull the apply readiness", "One action, changes with state (Recommended)";
// "on the job drawer, on the "Application" tab, beside these. I should see a tab with Apply readiness and with Account/Credentials"): the ⋯ menu's item follows the stored check, and the drawer's
// two new parts read the same check. renderer/apply-readiness-view.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountOf, fixAllOf, menuItemOf, readinessOf} from '../../../renderer/apply-readiness-view.js';

const clean = {eligible: true, captcha: false, login: false, accountCreation: false};
const READS = {
  notChecked: null,
  login: {...clean, login: true, simple: false, why: 'login'},
  account: {...clean, accountCreation: true, simple: false, why: 'account'},
  details: {...clean, simple: true, questions: ['Salary'], match: {missing: [{kind: 'detail', label: 'Salary expectation'}, {kind: 'answer', label: 'How did you perform in mathematics at high school?'}], unjudged: 0}},   // the match's real shape (lib/triage-match.js missingOf): #4325, a fake {name} hid that the drawer listed none
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
  assert.deepEqual(readinessOf(READS.notChecked), {checked: false, chip: {label: 'Not checked', tone: 'neutral'}, found: '', todo: [], missing: [], counts: {questions: null, answered: null, unjudged: null}, blocked: false, button: 'Check apply readiness'});
  const login = readinessOf(READS.login);
  assert.equal(login.chip.label, 'Needs you');
  assert.deepEqual(login.missing, ['Sign in on the employer\'s site']);
  assert.equal(login.button, 'Check again');
  assert.deepEqual(readinessOf(READS.account).missing, ['An account on the employer\'s site']);
  assert.deepEqual(readinessOf(READS.details).missing, ['Salary expectation', 'How did you perform in mathematics at high school?']);
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

test("the form's required questions as counts: answered = asked − missing − not judged; a check that read no questions says so, never a zero", () => {
  // Why (14 Nov 2026, #4325, owner: "On the main content, we should show more details. How many fields...").
  const read = {...clean, simple: true, questions: Array.from({length: 19}, (_, i) => `Question ${i}`), match: {missing: [{kind: 'detail', label: 'Nationality'}, {kind: 'detail', label: 'Native language'}, {kind: 'answer', label: 'Why us?'}], unjudged: 1}};
  assert.deepEqual(readinessOf(read).counts, {questions: 19, answered: 15, unjudged: 1});
  assert.deepEqual(readinessOf(READS.login).counts, {questions: null, answered: null, unjudged: null}, 'a sign-in page: its questions were not read');
  assert.deepEqual(readinessOf({...clean, simple: true, questions: ['Phone']}).counts, {questions: 1, answered: null, unjudged: null}, 'read but not matched yet: answered is not known');
  assert.deepEqual(readinessOf(READS.login).todo, [{kind: 'sign-in', words: "Sign in on the employer's site", action: {type: 'site'}}]);
  assert.equal(readinessOf(READS.login).blocked, true);
  assert.equal(readinessOf(READS.details).blocked, false, "saved details are the person's to add, not a site that blocks");
});

test('"it can be filled" only when every question was read, matched and found good; otherwise the check\'s own words (Gitar on #4379)', () => {
  assert.equal(readinessOf(READS.ready).ready, true);
  for (const read of [{unreadable: true}, {...clean, simple: true, questions: ['Phone']}, {...clean, simple: false, why: 'many pages'}, {...clean, simple: true, questions: ['A'], match: {missing: [], unjudged: 1}}]) {
    const view = readinessOf(read);
    assert.equal(view.ready, false, JSON.stringify(read));
    assert.ok(view.found, 'the drawer has words of its own to say instead');
  }
});

test('every to-do gets its one button: the site for a sign-in, an account or a check; the queue for a saved detail or a question; "Fix all" lists exactly the queue ones', () => {
  // Why (14 Nov 2026, #4325, owner: "The apply readiness should give some call to actions, to make it ready").
  const todo = readinessOf({...READS.details, login: true, captcha: true}).todo;
  assert.deepEqual(todo.map(item => [item.kind, item.action]), [
    ['sign-in', {type: 'site'}], ['check', {type: 'site'}],
    ['detail', {type: 'queue', queue: 'details', label: 'Salary expectation'}],
    ['answer', {type: 'queue', queue: 'learned', label: 'How did you perform in mathematics at high school?'}]]);
  assert.deepEqual(fixAllOf(todo), {count: 2, groups: [{queue: 'details', labels: ['Salary expectation']}, {queue: 'learned', labels: ['How did you perform in mathematics at high school?']}]}, 'Your details first, then the questions');
  assert.deepEqual(fixAllOf(todo.filter(item => item.kind === 'answer')), {count: 1, groups: [{queue: 'learned', labels: ['How did you perform in mathematics at high school?']}]});
  assert.equal(fixAllOf(readinessOf(READS.login).todo), null, 'a sign-in alone has no queue to fix');
  assert.equal(readinessOf(READS.details).blocked, false, 'a question in the queue is not the posting that blocks');
});
