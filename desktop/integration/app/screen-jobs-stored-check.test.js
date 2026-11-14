/* global document */
// A job's stored apply check survives a restart on Jobs, layer 2: the app's demo window on fictional jobs whose rows carry a stored check (the record's `apply_readiness`, packed by
// lib/apply-readiness.js), opened fresh (a restart: the window holds no read of its own) and again after a reload (⌘R). No Check is pressed: each checked row must already show its
// "Needs you" line and, for a sign-in or account page, the "Account needed" chip; an unchecked row stays "Not checked" with no chip; a check made for an older posting is not shown.
// Why (13 Nov 2026, owner, relayed by the coordinator: "Fix it in this PR" · "Make it stand out"): the window kept its checks only in memory, so a restart put every row back to "Not checked".
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {pack} from '../../lib/apply-readiness.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const POSTED = '2099-01-01';
const clean = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null};
// expect: the words the person reads, written out here (not derived from the renderer's tables, which would pass with a table wrong).
const CASES = [
  {name: 'sign-in page', stored: {...clean, login: true, simple: false, why: 'login'}, label: 'Needs you', detail: 'login wall', account: 'Account needed'},
  {name: 'account to create', stored: {...clean, accountCreation: true, simple: false, why: 'account'}, label: 'Needs you', detail: 'asks you to create an account', account: 'Account needed'},
  {name: 'never checked', stored: null, label: 'Not checked', detail: '', account: ''},
  {name: 'checked for an older posting', stored: {...clean, login: true, simple: false, why: 'login'}, posted: '2098-06-01', label: 'Not checked', detail: '', account: ''},
  // Owner, 14 Nov 2026 (asked via AskUserQuestion: "LinkedIn Easy Apply"): LinkedIn's own job page said Easy Apply (the row's apply_route, src/desktop_jobs.py): that chip, checked or not.
  {name: 'LinkedIn Easy Apply, never checked', stored: null, route: 'linkedin', label: 'Not checked', detail: '', account: 'LinkedIn Easy Apply'},
  {name: 'LinkedIn Easy Apply with a sign-in check', stored: {...clean, login: true, simple: false, why: 'login'}, route: 'linkedin', label: 'Needs you', detail: 'login wall', account: 'LinkedIn Easy Apply'},
].map((item, index) => ({...item, url: `https://jobs.stored-check.example/roles/${index + 1}`}));
const JOBS = CASES.map((item, index) => ({id: index + 1, code: `s${index + 1}`, title: `Stored Check Engineer ${index + 1}`, company: 'Stored check fixtures', stage: null, location: 'Zurich',
  work_mode: 'Hybrid', url: item.url, posted_at: POSTED, first_seen_at: POSTED, status: 'unreviewed', fit: 90 - index, reason: 'A fictional match.', rank: 100 - index, skills: ['Go'],
  ...(item.stored ? {apply_readiness: pack(item.stored, {posted: item.posted || POSTED})} : {}), ...(item.route ? {apply_route: item.route} : {})}));
let seen;

before(() => {
  if (needsElectron.skip) return;
  // Serialised into the window with the scripts (window-probe.js `use`): no closure over this file.
  const rowsOf = base => ({rows: async () => {
    await base.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await base.go('jobs');
    await base.until(() => document.querySelectorAll('article.job-row').length >= 6, 'the six job rows');
    return [...document.querySelectorAll('article.job-row')].map(row => ({url: row.dataset.url,
      label: row.querySelector('.role > .chip-tag .chip-value')?.textContent.trim() || '', detail: row.querySelector('.role > .chip-tag .chip-detail')?.textContent.trim() || '',
      account: row.querySelector('.tags .ui-tag.is-account')?.textContent.trim() || ''}));
  }});
  seen = probeWindow({files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, use: [rowsOf], timeout: 180000, script: kit => kit.rows(), after: async (kit, opened) => ({opened, reloaded: await kit.rows()})}).result;
});

for (const moment of ['opened', 'reloaded']) {
  test(`${moment}: each row shows its stored check with no Check pressed, and "Account needed" only where the page asks for an account`, live, () => {
    for (const item of CASES) {
      const row = seen[moment].find(found => found.url === item.url);
      assert.ok(row, `${item.name}: its row is on Jobs`);
      assert.deepEqual({label: row.label, detail: row.detail, account: row.account}, {label: item.label, detail: item.detail, account: item.account}, `${item.name} (${moment})`);
    }
  });
}
