// One-job Apply drives the real Jobs renderer: hidden-browser replies show Sessions or the refusal, never Chrome's Opened state.
// Cheapest-layer coverage: apply-one-follows-mode.test.js pins saved mode → queued reply with visible launchers forbidden; this file pins that reply → row and Sessions toast.
// No existing journey expectation changed: the Standard-mode journeys keep their meaning; no new browser journey is needed to exercise this renderer branch.
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
let reply, reads = 0, held = Promise.resolve();   // held: a readiness answer the test releases
const calls = [], views = [];
globalThis.window.pilot = new Proxy({
  applyReadiness: async (job, options) => { calls.push(['applyReadiness', job.url, options]); await held; return {kit: {ok: true}, check: null}; },   // R2 (8 Nov 2026): every row Apply gets the job ready first
  applyOne: async (...args) => { calls.push(args); return reply; },
  jobs: async () => { reads++; return null; },
  pageView: async view => { views.push(view); },
}, {get: (all, key) => all[key] || (async () => null)});
const {shared} = await import('../../../renderer/pages/shared.js');
const {jobsState} = await import('../../../renderer/pages/jobs-state.js');
const {renderJobs, applySaved} = await import('../../../renderer/pages/jobs-render.js');
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
  return {job, button};
}

test('pressing Apply on a row queued in Background mode marks Applying, rereads jobs and links its success toast to Sessions without marking Chrome opened', async () => {
  const {job, button} = draw({background: true, ok: true, message: '1 application queued in the background.'});
  await button.listeners.click[0]({});
  assert.deepEqual(calls, [['applyReadiness', job.url, {say: true}], [job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode}, null]], 'Apply readiness first, then the start in the saved mode (no pick)');
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
  assert.equal(button.textContent, 'Apply in Chrome');
  const toast = $('toasts').querySelector('.toast');
  assert.match(toast.textContent, /Apply did not startConfirm Full automation in Settings first\./);
  assert.equal(toast.classList.contains('tone-warn'), true);
  assert.doesNotMatch($('toasts').textContent, /No link|Could not open the job/);
});

// Owner, 7 Nov 2026 ("Change the label (Recommended)"): the row's Apply button says where the application runs, from the saved mode.
test('the row\'s Apply button says the saved mode: in Chrome, in background, automatically', () => {
  const was = shared.state;
  try {
    for (const [mode, label] of [['check', 'Apply in Chrome'], ['fill', 'Apply in background'], ['auto', 'Apply automatically']]) {
      shared.state = {settings: {apply: {mode, chosenAt: '2026-11-07T00:00:00Z', ...(mode === 'auto' ? {autoConfirmedAt: '2026-11-07T00:00:00Z'} : {})}}};
      assert.equal(draw({ok: true}).button.textContent, label, mode);
    }
    shared.state = {settings: {}};
    assert.equal(draw({ok: true}).button.textContent, 'Apply in Chrome', 'nothing saved reads as Standard automation');
  } finally { shared.state = was; }
});

// Gitar review on #3437: saving the mode in Settings → Apply must redraw the rows, not only remember it. Plays the save: the
// rows are drawn in Standard, Settings saves Background, and the same list now says "Apply in background" without another action.
test('saving a new Apply mode in Settings redraws the rows with its label', () => {
  const was = shared.state;
  try {
    shared.state = {settings: {apply: {mode: 'check', chosenAt: '2026-11-07T00:00:00Z'}}};
    assert.equal(draw({ok: true}).button.textContent, 'Apply in Chrome');
    applySaved({apply: {mode: 'fill', chosenAt: '2026-11-07T00:00:00Z'}});
    assert.equal($('jobs-body').querySelector('button.row-main').textContent, 'Apply in background');
  } finally { shared.state = was; }
});

// Code review of R2 (8 Nov 2026): a ⋯ menu pick closed the menu and said nothing for the 20-40 s of Apply readiness, and a second pick drafted and queued the same job twice.
test("a ⋯ menu pick says the check runs, and a second pick on the same job while it runs starts nothing", async () => {
  const {createRowApply} = await import('../../../renderer/pages/jobs-apply-row.js');
  const {job} = draw({background: true, ok: true, message: '1 application queued in the background.'});
  let release;
  held = new Promise(done => { release = done; });
  const pick = createRowApply(job, {rerender: () => {}}).modeItems().find(item => item.label === 'Background automation');
  const first = pick.run(), second = pick.run();
  await second;
  assert.match($('toasts').textContent, /Checking apply readiness/, 'the pick says the check runs');
  release();
  await first;
  held = Promise.resolve();
  assert.deepEqual(calls.map(call => call[0]), ['applyReadiness', job.url], 'one readiness, one start');
  assert.deepEqual(calls[1][2], {mode: 'fill', autoConfirmedAt: ''}, 'the pick goes with the start');
});

// Code review of R2 (8 Nov 2026): a form filled on the server opens its hand-off (Review and submit); the ⋯ menu's per-job modes would start it afresh and skip those answers.
test("a job filled on the server offers no per-job Apply modes; a job with a kit does", async () => {
  const menuOf = more => {
    const row = $('jobs-body').querySelector('article.job-row');
    const button = [...row.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === more);
    button.listeners.click[0]({stopPropagation() {}, preventDefault() {}});
    return [...doc.querySelectorAll('.ui-menu-heading')].map(item => item.textContent);
  };
  const {job} = draw({ok: true});
  const more = [...$('jobs-body').querySelectorAll('button')].map(item => item.getAttribute('aria-label')).find(Boolean);
  assert.deepEqual(menuOf(more), ['Apply to this job with'], `the ⋯ menu (${more}) of a job with a kit offers the modes`);
  job.ready = true;
  (await import('../../../renderer/components.js')).closeMenu();
  renderJobs();
  assert.deepEqual(menuOf(more), [], 'a server-filled job offers none');
});
