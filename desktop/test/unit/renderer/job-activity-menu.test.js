// Jobs ⋯ menu: one way in for everything that happens on a job (owner, 13 Nov 2026: "Add job activity"); no separate employer-feedback items.
// Draws the real Jobs renderer (like jobs-apply-background.test.js) and reads the open ⋯ menu of a rejected job that holds employer feedback.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
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
globalThis.window.pilot = new Proxy({}, {get: (all, key) => all[key] || (async () => null)});
const {shared} = await import('../../../renderer/pages/shared.js');
const {jobsState} = await import('../../../renderer/pages/jobs-state.js');
const {renderJobs} = await import('../../../renderer/pages/jobs-render.js');
const $ = id => doc.getElementById(id);

function menuOf(job) {
  shared.allJobs = [job];
  jobsState.filters = ['all']; jobsState.statFilter = null;
  $('sort-by').value = 'best'; $('filter-text').value = '';
  renderJobs();
  $('jobs-body').querySelector('.ui-more').click();
  return doc.body.querySelector('.ui-menu').querySelectorAll('button').map(button => button.textContent);
}

test('the ⋯ menu offers "Add job activity" and no employer-feedback items, even on a rejected job holding feedback', () => {
  for (const job of [
    {url: 'https://jobs.example.test/one', page_id: 'p1', title: 'Engineer', company: 'Acme', stage: 'Rejected', status: 'saved', employer_feedback: 'We wanted more Kubernetes depth.', skills: []},
    {url: 'https://jobs.example.test/two', page_id: 'p2', title: 'Engineer', company: 'Acme', stage: 'Applied', status: 'saved', skills: []},
  ]) {
    const labels = menuOf(job);
    assert.ok(labels.some(label => /Add job activity/.test(label)), `${job.stage}: ${labels.join(' | ')}`);
    assert.ok(!labels.some(label => /employer feedback/i.test(label)), `${job.stage}: ${labels.join(' | ')}`);
  }
});
