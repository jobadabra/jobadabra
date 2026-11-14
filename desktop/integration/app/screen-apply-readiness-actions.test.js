/* global document, KeyboardEvent */
// Every to-do of a job's Apply readiness has a button (owner, 14 Nov 2026, #4325: "The apply readiness should give some call to actions, to make it ready" · "make it easy for him to fix all the issues
// ... Either using the answers queue"): the real app window on demo data. "Add it" opens Your details on that fact, "Answer it" opens What we learned on that question, "Fix all" holds exactly this job's
// items (one drawer after the other), and closing the queue brings the job's drawer back on Apply readiness. The queue's own write (a question not yet in it) is test/unit/main/queue-job-missing.test.js:
// the demo window has no store to write to.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {readFromJudge} from '../../lib/triage-read.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const URL = 'https://jobs.readiness-actions.example/roles/1';
const JOB = {id: 1, code: 'ra1', title: 'Readiness Actions Engineer', company: 'Acme', stage: null, location: 'Zurich', work_mode: 'Hybrid', url: URL, posted_at: '2099-01-01', first_seen_at: '2099-01-01',
  status: 'unreviewed', fit: 90, reason: 'A fictional match.', rank: 100, skills: []};
const READ = {...readFromJudge({botCheck: false, loginWall: false, accountCreation: false}), simple: true, why: '', questions: ['What is your citizenship?', 'Tell us about your hobbies', 'Describe a project you led']};
const MATCH = {[URL]: {missing: [{kind: 'detail', label: 'Nationality', asked: 'What is your citizenship?'}, {kind: 'answer', label: 'Tell us about your hobbies', asked: 'Tell us about your hobbies'}, {kind: 'answer', label: 'Describe a project you led', asked: 'Describe a project you led'}], unjudged: 0}};
const row = (key, question, fact) => ({key, question, hint: '', format: {kind: 'text', options: [], list: ''}, details: {kind: 'missing', where: 'Work eligibility', fact}});
const DETAILS = [row('details:missing:{"id":"notice"}', 'How long is your notice period?', 'Notice period'), row('details:missing:{"id":"nationality"}', 'What is your nationality?', 'Nationality')];
const LEARNED = [{key: 'q-other', question: 'Another form asked this', company: 'Beta'}, {key: 'q-hobbies', question: 'Tell us about your hobbies', company: 'Acme'}];
let screen;

before(() => {
  if (needsElectron.skip) return;
  screen = probeWindow({settings: {demoTriageReads: {[URL]: READ}, demoTriageMatch: MATCH, demoDetailsReview: DETAILS, openQuestions: LEARNED}, files: {'jobs.json': {jobs: [JOB], total: 1, filtered: 1}}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    await kit.until(() => document.querySelectorAll('article.job-row').length >= 1, 'the job row');
    const text = selector => (document.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
    const drawerButtons = () => [...document.querySelectorAll('#job-drawer-layer .jd-icon-row.has-action button, #job-drawer-layer .jd-actions button')].map(node => node.textContent.trim());
    const press = (label, nth = 0) => [...document.querySelectorAll('#job-drawer-layer button')].filter(node => node.textContent.trim() === label)[nth].click();
    const reviewOpen = () => !document.getElementById('review-drawer-layer').hidden;
    const reviewText = () => text('#review-drawer-layer');
    const closeReview = async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
      await kit.until(() => document.getElementById('review-drawer-layer').hidden, 'the queue closed');
      await kit.until(() => !document.getElementById('job-drawer-layer').hidden && text('#job-drawer-layer').includes("What's missing"), "the job's drawer back on Apply readiness");
    };
    document.querySelector('article.job-row .ui-more').click();
    (await kit.until(() => [...document.querySelectorAll('[role=menuitem]')].find(node => node.textContent.trim() === 'Check apply readiness'), 'the ⋯ item')).click();
    await kit.until(() => drawerButtons().includes('Add it'), 'the drawer on Apply readiness with its buttons');
    const buttons = drawerButtons();
    press('Add it');
    await kit.until(reviewOpen, 'the queue opened by Add it');
    await kit.until(() => reviewText().includes('What is your nationality?'), 'Your details on the Nationality question');
    const addIt = {text: reviewText(), jobDrawerHidden: document.getElementById('job-drawer-layer').hidden};
    await closeReview();
    press('Answer it');
    await kit.until(() => reviewOpen() && reviewText().includes('Tell us about your hobbies'), 'What we learned on the hobbies question');
    const answerIt = reviewText();
    await closeReview();
    press('Answer it', 1);   // Gitar on #4401: a label the queue does not hold opens nothing (never the whole queue)
    await new Promise(resolve => setTimeout(resolve, 1500));
    const unresolvedOpened = reviewOpen();
    await kit.until(() => !document.getElementById('job-drawer-layer').hidden && text('#job-drawer-layer').includes("What's missing"), "the job's drawer still on Apply readiness");
    press('Fix all 3 in the queue');
    await kit.until(() => reviewOpen() && reviewText().includes('What is your nationality?'), 'Fix all: the queue at the first item');
    const fixAll = {text: reviewText(), queue: text('#review-drawer-layer h2')};
    await closeReview();
    return {buttons, addIt, answerIt, fixAll, unresolvedOpened};
  }});
});

test('each to-do has its own button and "Fix all" counts the queue ones; Check again steps back', live, () => {
  assert.deepEqual(screen.result.buttons, ['Fix all 3 in the queue', 'Check again', 'Add it', 'Answer it', 'Answer it']);
});

test('"Add it" / "Answer it" open the queue focused on that exact question, not on the queue\'s own first item', live, () => {
  // Owner, 14 Nov 2026: "Open the queue drawer, but focuses on that particular question or job". The queue's own first items are the notice period (Your details) and another form's question (What we learned).
  assert.match(screen.result.addIt.text, /What is your nationality\?/);
  assert.doesNotMatch(screen.result.addIt.text, /notice period/);
  assert.equal(screen.result.addIt.jobDrawerHidden, true, 'one overlay at a time: the queue replaces the job drawer, which comes back on close');
  assert.match(screen.result.answerIt, /Tell us about your hobbies/);
  assert.doesNotMatch(screen.result.answerIt, /Another form asked this/);
});

test('a to-do whose question the queue does not hold opens nothing: never the whole queue (Gitar on #4401)', live, () => {
  assert.equal(screen.result.unresolvedOpened, false);
});

test('"Fix all" is the same press for this job\'s first item: the queue focused on it, never another question first; the job drawer comes back on close', live, () => {
  // Design (14 Nov 2026, owner: "Simple: open the queue at this job's first item (Recommended)"): the whole queue opens, on this job's first item; the job's other items follow in the queue's own ranking.
  assert.match(screen.result.fixAll.text, /What is your nationality\?/);
  assert.doesNotMatch(screen.result.fixAll.text, /notice period/);
});
