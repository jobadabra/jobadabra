// "What happened" (renderer/session-steps-list.js; owner, 9 Oct 2026): a session's steps in plain words instead of a terminal. Each state a session card shows
// gets its steps: started, stuck at an account page or with no form, the form read and filled with suggestions, the person's turn, submitted.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sessionSteps} from '../../../renderer/session-steps-list.js';

const texts = steps => steps.map(step => `${step.tone}: ${step.text}`);

test('a session\'s steps, for every state its card shows', () => {
  const time = () => '14:45';
  assert.deepEqual(texts(sessionSteps({startedAt: 'x', status: 'running', note: 'Filling the form…'}, null, {time})), ['done: Opened the job in Chrome · 14:45', 'now: Filling the form…']);
  assert.deepEqual(texts(sessionSteps({stuck: 'account', note: 'Needs you: Solve the check, then press "Connexion"'}, {account: true, total: 3, left: 3})),
    ['done: Opened the job in Chrome', 'warn: Needs you: Solve the check, then press "Connexion"']);   // an account page's fields are not the form's
  assert.deepEqual(texts(sessionSteps({stuck: 'no-form'})), ['done: Opened the job in Chrome', 'warn: No application form found on the page yet']);
  const report = {total: 18, left: 12, proposals: [{label: 'a', value: 'Oui'}, {label: 'b', value: ''}, {label: 'c', value: 'Suisse'}]};
  assert.deepEqual(texts(sessionSteps({status: 'done'}, report)),
    ['done: Opened the job in Chrome', 'done: Read the form: 18 required fields', 'done: Filled 6 of 18', 'done: 2 answers suggested for you to check', 'now: Your turn: 12 fields left, then submit in Chrome']);
  assert.equal(texts(sessionSteps({status: 'done'}, {total: 1, left: 0})).at(-1), 'now: Your turn: review and submit in Chrome');
  assert.equal(texts(sessionSteps({status: 'done'}, report, {submitted: true})).at(-1), 'done: Submitted · marked Applied');
});

test('the terminal is only for a Claude conversation with the takeover on (resumeOffered); elsewhere the steps, and the terminal one click away', () => {
  const page = readScreenSource(new URL('../../../renderer/pages/session-steps.js', import.meta.url), 'utf8');
  assert.match(page, /export const terminalShown = item => \(resumeOffered\(\) && \(item\.kind \|\| 'claude'\) === 'claude'\) \|\| logAsked\.has\(item\.id\);/);
  const log = readScreenSource(new URL('../../../renderer/pages/session-log.js', import.meta.url), 'utf8');
  assert.match(log, /show\(\$\('ss-log'\), terminalShown\(item\)\);/);
  assert.match(readScreenSource(new URL('../../../renderer/index.html', import.meta.url), 'utf8'), /<ul class="activity-phases" id="ss-steps"><\/ul>/);   // Recent activity's step list, reused
});

test('an email posting says where to send it once, not twice', () => {
  const time = () => '14:45';
  const email = {startedAt: 'x', status: 'running', stuck: 'email', note: 'Send your application to jobs@firma.ch'};
  assert.deepEqual(texts(sessionSteps(email, null, {time})), ['done: Opened the job in Chrome · 14:45', 'warn: Send your application to jobs@firma.ch']);
});

test('a page that tells the person what to do shows its own sentence once, like an email posting', () => {
  const time = () => '14:45';
  const told = {startedAt: 'x', status: 'running', stuck: 'told', note: 'The page says: Rufen Sie uns an: 044 555 01 00'};
  assert.deepEqual(texts(sessionSteps(told, null, {time})), ['done: Opened the job in Chrome · 14:45', 'warn: The page says: Rufen Sie uns an: 044 555 01 00']);
});

test('a page the ladder could not read says so once and asks the person to open it', () => {
  const time = () => '14:45';
  const other = {startedAt: 'x', status: 'running', stuck: 'other', note: 'Jobadabra could not tell how to apply: open the page'};
  assert.deepEqual(texts(sessionSteps(other, null, {time})), ['done: Opened the job in Chrome · 14:45', 'warn: Jobadabra could not tell how to apply: open the page']);
});

// Owner, 5 Nov 2026: "We should have live update log … so that the user gets a good sense even without live preview or opening in the browser" ([ap] 5/7).
test('a hidden-browser session shows its own live log with times, never "in Chrome", its latest step as now', () => {
  const time = at => `10:00:0${at % 10}`;
  const steps = [{at: 1, text: 'Started in Jobadabra\'s browser · Full automation', tone: 'done'}, {at: 2, text: 'Opening the job page', tone: 'done'}, {at: 3, text: 'Filling the form: 4 of 9 required fields', tone: 'done', key: 'fill'}];
  const filling = {status: 'running', note: 'Filling in the background', background: {mode: 'auto', state: 'filling'}, journal: steps};
  assert.deepEqual(texts(sessionSteps(filling, {total: 9, left: 5}, {time})),
    ['done: Started in Jobadabra\'s browser · Full automation · 10:00:01', 'done: Opening the job page · 10:00:02', 'now: Filling the form: 4 of 9 required fields · 10:00:03']);
  const handed = {...filling, background: {mode: 'auto', state: 'needs_user_handoff'}, journal: [...steps, {at: 4, text: 'Handed to you: a bot check', tone: 'warn'}]};
  assert.equal(texts(sessionSteps(handed, null, {time})).at(-1), 'warn: Handed to you: a bot check · 10:00:04');
  const sent = {...filling, outcome: 'submitted', journal: [...steps, {at: 5, text: 'Submitted · marked Applied', tone: 'done'}]};
  assert.equal(texts(sessionSteps(sent, null, {submitted: true, time})).at(-1), 'done: Submitted · marked Applied · 10:00:05', 'said once, done');
  assert.ok(texts(sessionSteps({...filling, journal: []}, null, {time})).length, 'no log yet (the app restarted): the derived steps');
});
