/* global document, getComputedStyle */
// Apply to jobs → a held Full automation batch ([fa] 2/2, spec docs/superpowers/specs/2026-11-07-full-automation-check-first.md), layer 2: the app's demo window shows the real panel
// (renderer/pages/apply-check.js, its markup and CSS) for five fictional jobs: the forms checked live, then the split, then Confirm sends only the automatic jobs; Cancel ends the batch.
// The app's calls are stand-ins handed to runCheck (the demo blocks 'apply', so a demo window never holds a batch); what the app does with the answer, with the real handlers, controller
// and store over a fake hidden browser, is test/unit/main/apply-check-first.test.js. Nothing opens, fills or sends.
// Guard: safety — the panel sends Confirm only with the jobs its split shows under Full automation, and Cancel or closing the dialog ends the batch with nothing confirmed.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
let confirmed, cancelled;

// The five jobs, their reads and the app's match, and stand-ins for the app's calls that record what the panel sends. Serialised into the window with the script.
const kitOf = () => ({stage(release) {
  const simple = {eligible: true, captcha: false, login: false, accountCreation: false, simple: true, why: '', questions: ['Full name']};
  const jobs = ['Northwind Labs', 'Bluefin Health', 'Corvid Systems', 'Helio Freight', 'Larkspur Bank'].map((company, i) => ({url: `https://jobs.check-first.example/${i + 1}`, company, title: `Fictional Engineer ${i + 1}`, read: null}));
  const reads = [simple, simple, simple, {...simple, simple: false, captcha: true, why: 'captcha'}, {unreadable: true, why: 'timeout'}];
  const matched = [{missing: [], unjudged: 0}, {missing: [], unjudged: 0}, {missing: [{kind: 'detail', label: 'Phone number'}], unjudged: 0}];
  const sent = {reads: [], confirm: null, cancel: []};
  const calls = {
    applyCheckRead: async (plan, url) => { sent.reads.push(url); const i = jobs.findIndex(job => job.url === url); if (i === 2) await release; return reads[i]; },
    applyCheckMatch: async () => ({reads: Object.fromEntries(jobs.map((job, i) => [job.url, matched[i] ? {...reads[i], match: matched[i]} : reads[i]]))}),
    applyCheckConfirm: async (plan, autoUrls) => { sent.confirm = {plan, autoUrls}; return {ok: true, outcomes: autoUrls.map(url => ({url, status: 'started'}))}; },
    applyCheckCancel: async plan => { sent.cancel.push(plan); return {ok: true}; },
  };
  return {jobs, calls, sent};
}});

before(() => {
  if (needsElectron.skip) return;
  confirmed = probeWindow({use: [kitOf], timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    document.getElementById('apply-open').click();
    await kit.until(() => document.getElementById('apply-dialog').open, 'the Apply to jobs dialog');
    let release;
    const {jobs, calls, sent} = kit.stage(new Promise(resolve => { release = resolve; }));
    const {runCheck} = await import('./pages/apply-check.js');
    const settled = {};   // the panel's answer, read by a state wait (its hang guard names a panel that never answers)
    const answer = runCheck({plan: 'p1', allowIneligible: false, jobs: jobs.map((job, i) => (i === 0 ? {...job, read: {eligible: true, captcha: false, login: false, accountCreation: false, simple: true, why: '', questions: []}} : job))}, calls);
    const busy = await kit.until(() => document.getElementById('apply-check-now').textContent.includes('Corvid') && document.querySelector('#apply-check-list .apply-check-busy') && {
      now: document.getElementById('apply-check-now').textContent, rows: [...document.querySelectorAll('#apply-check-list li')].map(li => li.textContent),
      formHidden: getComputedStyle(document.getElementById('apply-mode-cards').closest('fieldset')).display === 'none', goHidden: document.getElementById('apply-check-go').hidden}, 'the third form in flight');
    release();
    await kit.until(() => !document.getElementById('apply-check-go').hidden, 'the split');
    const split = {title: document.getElementById('apply-check-title').textContent, groups: [...document.querySelectorAll('.apply-check-group')].map(group => [group.className.match(/tone-(\w+)/)[1], group.querySelectorAll('li').length]),
      go: document.getElementById('apply-check-go').textContent, mix: document.querySelectorAll('#apply-check-mix > span').length};
    document.getElementById('apply-check-go').click();
    answer.then(value => { settled.p1 = value; });
    const result = await kit.until(() => settled.p1, 'the answer to Confirm');
    return {busy, split, sent, result, panelHidden: document.getElementById('apply-check').hidden};
  }});
  cancelled = probeWindow({use: [kitOf], timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    document.getElementById('apply-open').click();
    await kit.until(() => document.getElementById('apply-dialog').open, 'the Apply to jobs dialog');
    const {jobs, calls, sent} = kit.stage(new Promise(() => {}));   // the third read never ends: the person cancels while it runs
    const {runCheck} = await import('./pages/apply-check.js');
    const settled = {};
    const answer = runCheck({plan: 'p2', allowIneligible: false, jobs}, calls);
    await kit.until(() => document.getElementById('apply-check-now').textContent.includes('Corvid'), 'the third form in flight');
    document.getElementById('apply-check-cancel').click();
    answer.then(value => { settled.p2 = value; });
    const result = await kit.until(() => settled.p2, 'the answer to Cancel while a read runs');
    const second = runCheck({plan: 'p3', allowIneligible: false, jobs: jobs.slice(0, 2)}, calls);
    await kit.until(() => !document.getElementById('apply-check-go').hidden, 'a second batch at its split');
    document.getElementById('apply-dialog').close();   // Esc or the window's close: the same as Cancel
    second.then(value => { settled.p3 = value; });
    return {sent, result, closed: await kit.until(() => settled.p3, 'the answer to closing the dialog'), formBack: getComputedStyle(document.getElementById('apply-n')).display !== 'none'};
  }});
});

test('the check runs live, then the split: 2 automatic, 1 Background, 1 in Chrome, 1 not applied; Confirm sends only the automatic jobs', live, () => {
  const {busy, split, sent, result, panelHidden} = confirmed.result;
  assert.equal(busy.now, 'Checking 3 of 5 · Corvid Systems');
  assert.deepEqual(busy.rows.map(row => row.replace(/Fictional Engineer \d · /, '').replace(/^.*?(Simple form|Checking…|Waiting)$/, '$1')), ['Simple form', 'Simple form', 'Checking…', 'Waiting', 'Waiting']);
  assert.equal(busy.formHidden, true, 'the panel replaces the form while it shows');
  assert.equal(busy.goHidden, true, 'no Apply before the split');
  assert.deepEqual(sent.reads, ['https://jobs.check-first.example/2', 'https://jobs.check-first.example/3', 'https://jobs.check-first.example/4', 'https://jobs.check-first.example/5'], 'the job with a check from its kit is not read again');
  assert.equal(split.title, 'We can apply to 2 jobs automatically');
  assert.deepEqual(split.groups, [['good', 2], ['info', 1], ['warn', 1], ['neutral', 1]]);
  assert.equal(split.go, 'Apply to 4 jobs');
  assert.equal(split.mix, 4);
  assert.deepEqual(sent.confirm, {plan: 'p1', autoUrls: ['https://jobs.check-first.example/1', 'https://jobs.check-first.example/2']}, 'only the jobs shown under Full automation');
  assert.equal(result.ok, true);
  assert.equal(panelHidden, true);
});

test('Cancel during the check and closing the dialog at the split end the batch: nothing is confirmed and the form comes back', live, () => {
  const {sent, result, closed, formBack} = cancelled.result;
  assert.deepEqual(result, {cancelled: true});
  assert.deepEqual(closed, {cancelled: true});
  assert.deepEqual(sent.cancel, ['p2', 'p3']);
  assert.equal(sent.confirm, null);
  assert.equal(formBack, true);
});
