/* global document */
// Jobs, layer 2: "Kit ready" is internal (owner, 5 Nov 2026: "The user cares only about applying"): a job stored at that stage reads Saved on its row, on the Board and in the filter.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

// status: what src/desktop_jobs.py stage_status gives both stages (tests/unit/stores/test_desktop.py pins it).
const row = {location: '', work_mode: '', posted_at: '2099-01-01', first_seen_at: '2099-01-01', reason: '', skills: [], notion_url: '', origin: 'Outbound', status: 'saved'};
const job = (id, stage) => ({...row, id, code: `k${id}`, title: `Nurse ${id}`, company: `Clinic ${id}`, url: `https://jobs.kit-internal.example/${id}`, rank: id, stage});
const JOBS = [job(1, 'Kit ready'), job(2, 'Kit ready'), job(3, 'Saved')];

test('a job stored at Kit ready reads Saved on its row, sits in Saved on the Board, and the filter has no Ready to apply', {skip: needsElectron.skip}, () => {
  const {result} = probeWindow({files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=jobs]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    await kit.until(() => document.getElementById('filter-status'), 'the filter');
    document.getElementById('filter-status').click();
    await kit.until(() => [...document.querySelectorAll('[role=option], [role=menuitemcheckbox], label')].some(node => /Ready to submit/.test(node.textContent)), 'the filter menu');
    const menu = document.body.textContent;
    document.querySelector('.ui-multi [data-id="saved"]').click();
    document.querySelector('.ui-multi [data-id="open"]').click();
    await kit.until(() => document.querySelectorAll('article.job-row').length === 3, 'the three rows under Saved');
    const rows = [...document.querySelectorAll('article.job-row')].map(item => item.textContent);
    [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Board').click();
    await kit.until(() => document.querySelector('#jobs-board .board-column'), 'the Board');
    const columns = [...document.querySelectorAll('#jobs-board .board-column')].map(column => column.querySelector('.board-column-head').textContent.trim());
    const saved = document.querySelectorAll('#jobs-board .board-column[data-stage="Saved"] .board-card').length;
    return {readyToApply: /Ready to apply/.test(menu), columns, saved, rows};
  }});
  assert.equal(result.readyToApply, false, 'the filter still offers Ready to apply');
  assert.ok(result.rows.every(words => /Saved/.test(words) && !/\bNew\b|Kit ready/.test(words)), result.rows.join(' | '));
  assert.equal(result.saved, 3, `the Saved column holds every job; columns: ${result.columns.join(' | ')}`);
  assert.ok(!result.columns.some(words => /ready to apply|kit/i.test(words)), result.columns.join(' | '));
});
