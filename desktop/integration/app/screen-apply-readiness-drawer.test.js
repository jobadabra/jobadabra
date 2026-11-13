/* global document */
// A job's ⋯ menu and the drawer read the job's ONE stored check, layer 2: the app's demo window, the reads named per job (settings.demoTriageReads, lib/demo.js).
// Owner, 13 Nov 2026 (via the coordinator): "let's add a new action on the job to fulffull the apply readiness", "One action, changes with state (Recommended)"; "on the job drawer, on the
// "Application" tab, beside these. I should see a tab with Apply readiness and with Account/Credentials". Plays: the item says Check apply readiness, checks only that job, then says
// Fix what's missing, which opens the drawer on Apply readiness with what is missing; Account / Credentials says what the site asks and the matching saved sign-in, with no password.
// Job: check apply readiness
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {readFromJudge} from '../../lib/triage-read.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const plain = {botCheck: false, loginWall: false, accountCreation: false};
const job = (n, company) => ({id: n, code: `r${n}`, title: `Readiness Engineer ${n}`, company, stage: null, location: 'Zurich', work_mode: 'Hybrid', url: `https://jobs.readiness.example/roles/${n}`,
  posted_at: '2099-01-01', first_seen_at: '2099-01-01', status: 'unreviewed', fit: 90 - n, reason: 'A fictional match.', rank: 100 - n, skills: []});
const JOBS = [job(1, 'Migros'), job(2, 'Nobody Ltd')];   // Migros: the demo's saved sign-in lists it (lib/apply-handlers.js); Nobody: nothing saved
const READS = {[JOBS[0].url]: readFromJudge({...plain, loginWall: true}), [JOBS[1].url]: readFromJudge(plain, {allFactsSaved: true})};
let screen;

before(() => {
  if (needsElectron.skip) return;
  screen = probeWindow({settings: {demoTriageReads: READS}, files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    await kit.until(() => document.querySelectorAll('article.job-row').length >= 2, 'the two job rows');
    const row = url => [...document.querySelectorAll('article.job-row')].find(one => one.dataset.url === url);
    const items = async url => {
      row(url).querySelector('.ui-more').click();
      const list = await kit.until(() => [...document.querySelectorAll('[role=menuitem]')].map(node => node.textContent.trim()).filter(Boolean), 'the ⋯ menu');
      return list;
    };
    const press = label => [...document.querySelectorAll('[role=menuitem]')].find(node => node.textContent.trim() === label).click();
    const login = 'https://jobs.readiness.example/roles/1', ready = 'https://jobs.readiness.example/roles/2';
    const before = await items(login);
    press('Check apply readiness');
    await kit.until(() => document.getElementById('triage-progress')?.hidden === true && document.querySelectorAll('#triage-results li').length === 1, 'the one job checked');
    document.getElementById('triage-dialog').close();
    const otherAfter = (await items(ready)).filter(label => /readiness|missing|Check again/.test(label));
    document.body.click();
    const after = await items(login);
    press("Fix what's missing");
    const choice = () => [...document.querySelectorAll('#job-drawer-layer .jd-choice button')];
    const readiness = await kit.until(() => {
      const active = choice().find(node => node.getAttribute('aria-pressed') === 'true')?.textContent.trim();
      const body = document.querySelector('#job-drawer-layer .jd-state')?.parentElement?.textContent || '';
      return active && body.includes("What's missing") ? {active, body: body.replace(/\s+/g, ' ')} : '';
    }, 'the drawer on Apply readiness');
    choice().find(node => node.textContent.trim() === 'Account / Credentials').click();
    const account = await kit.until(() => {
      const text = document.querySelector('#job-drawer-layer .jd-card')?.textContent.replace(/\s+/g, ' ') || '';
      return text.includes('Saved sign-in') || text.includes('No saved sign-in') ? text : '';
    }, 'the Account / Credentials part');
    return {before: before.filter(label => /readiness|missing/.test(label)), otherAfter, after: after.filter(label => /readiness|missing|Check again/.test(label)), readiness, account};
  }});
});

test('the ⋯ item follows the stored check: Check apply readiness checks only that job, then it says Fix what\'s missing', live, () => {
  assert.deepEqual(screen.result.before, ['Check apply readiness']);
  assert.deepEqual(screen.result.after, ["Fix what's missing"]);
  assert.deepEqual(screen.result.otherAfter, ['Check apply readiness'], 'the other job was not checked');
});

test('Fix what\'s missing opens the drawer on Apply readiness, from the same check: Needs you, the sign-in it lacks, and Check again', live, () => {
  assert.equal(screen.result.readiness.active, 'Apply readiness');
  assert.match(screen.result.readiness.body, /Needs you/);
  assert.match(screen.result.readiness.body, /Sign in on the employer's site/);
  assert.match(screen.result.readiness.body, /Check again/);
});

test('Account / Credentials says what the site asks and the saved sign-in that matches the company, never a password', live, () => {
  assert.match(screen.result.account, /This site asks you to sign in/);
  assert.match(screen.result.account, /Saved sign-in for career2\.successfactors\.eu/);
  assert.match(screen.result.account, /Uses you@example\.com/);
  assert.match(screen.result.account, /Open Credentials/);
  assert.doesNotMatch(screen.result.account, /password:|••••/i);
});
