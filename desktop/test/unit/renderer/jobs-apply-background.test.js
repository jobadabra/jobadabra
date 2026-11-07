// One-job Apply drives the real Jobs renderer: hidden-browser replies show Sessions or the refusal, never Chrome's Opened state.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
// The imported pages own background clocks; let them run without keeping this renderer test process open.
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();
const doc = globalThis.document, found = doc.getElementById.bind(doc);
doc.getElementById = id => {
  let node = found(id);
  if (!node) {
    node = doc.createElement('div'); node.id = id; doc.body.append(node);
    if (id.startsWith('nav-')) { const dot = doc.createElement('span'); dot.className = 'nav-dot'; node.append(dot); }
  }
  return node;
};
let reply, reads = 0;
const calls = [], views = [];
globalThis.window.pilot = new Proxy({
  applyOne: async (...args) => { calls.push(args); return reply; },
  jobs: async () => { reads++; return null; },
  pageView: async view => { views.push(view); },
}, {get: (all, key) => all[key] || (async () => null)});
const {shared} = await import('../../../renderer/pages/shared.js');
const {jobsState} = await import('../../../renderer/pages/jobs-state.js');
const {renderJobs} = await import('../../../renderer/pages/jobs-render.js');
const $ = id => doc.getElementById(id);

function draw(result) {
  reply = result; calls.length = 0; reads = 0;
  const job = {url: 'https://jobs.example.test/one', title: 'Engineer', company: 'Acme', location: 'Berlin', work_mode: 'remote', stage: 'Kit ready', status: 'saved', kit: true, skills: []};
  shared.allJobs = [job]; shared.openedInChrome.clear();
  jobsState.filters = ['saved']; jobsState.statFilter = null;
  $('sort-by').value = 'best'; $('filter-text').value = '';
  $('toasts').replaceChildren();
  renderJobs();
  const button = $('jobs-body').querySelector('button.row-main');
  assert.equal(button.textContent, 'Apply');
  return {job, button};
}

test('pressing Apply on a row queued in Background mode marks Applying, rereads jobs and links its success toast to Sessions without marking Chrome opened', async () => {
  const {job, button} = draw({background: true, ok: true, message: '1 application queued in the background.'});
  await button.listeners.click[0]({});
  assert.deepEqual(calls, [[job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode}]]);
  assert.equal(job.stage, 'Applying', 'startedApplying patches the real row');
  assert.equal(reads, 1, 'and rereads the stored jobs');
  assert.equal(shared.openedInChrome.size, 0, 'hidden-browser success never marks a visible tab opened');
  const toast = $('toasts').querySelector('.toast');
  assert.match(toast.textContent, /Applying started1 application queued in the background/);
  assert.equal(toast.classList.contains('tone-good'), true);
  assert.equal(toast.classList.contains('toast-link'), true);
  toast.click();
  assert.equal(views.at(-1), 'sessions', 'the outcome target opens Sessions');
});

test('a hidden-browser refusal says why without changing the job or relabelling Apply as No link', async () => {
  const {job, button} = draw({background: true, ok: false, error: 'Confirm Full automation in Settings first.'});
  await button.listeners.click[0]({});
  assert.equal(job.stage, 'Kit ready');
  assert.equal(reads, 0);
  assert.equal(shared.openedInChrome.size, 0);
  assert.equal(button.textContent, 'Apply');
  const toast = $('toasts').querySelector('.toast');
  assert.match(toast.textContent, /Apply did not startConfirm Full automation in Settings first\./);
  assert.equal(toast.classList.contains('tone-warn'), true);
  assert.doesNotMatch($('toasts').textContent, /No link|Could not open the job/);
});
