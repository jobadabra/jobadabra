// Regression checks for batch progress overflow and Jobs actions during hidden-browser applications.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {needsElectron} from '../../needs-electron.js';

const desktop = fileURLToPath(new URL('../../..', import.meta.url));

test('Jobs uses each background state, opens the existing session, and labels its automation mode', needsElectron, () => {
  const setup = `try {
    const urls = [...document.querySelectorAll('.job-row')].slice(0, 3).map(row => row.dataset.url);
    const jobs = urls.map(url => window.__jp.shared.allJobs.find(job => job.url === url));
    const states = ['queued', 'filling', 'ready_for_review'];
    window.__jp.sessions.splice(0, window.__jp.sessions.length, ...jobs.map((job, i) => ({
      id: 'ui-test-' + i, url: job.url, title: job.title, company: job.company,
      status: 'done', startedAt: new Date().toISOString(),
      background: {mode: i === 2 ? 'auto' : 'fill', state: states[i]}
    })));
    for (const job of jobs) { job.kit = true; job.status = 'unreviewed'; }
    document.dispatchEvent(new Event('jobs-rerender'));
    window.__uiJobs = jobs.map(job => {
      const row = [...document.querySelectorAll('.job-row')].find(row => row.dataset.url === job.url);
      return {text: row.textContent, action: row.querySelector('.row-main')?.textContent};
    });
    document.getElementById('apply-open').click();
    await new Promise(r => setTimeout(r, 100));
    const dialog = document.getElementById('apply-dialog');
    const status = document.getElementById('apply-start-status');
    document.getElementById('apply-start-banner').hidden = false;
    document.getElementById('apply-progress').hidden = false;
    Object.assign(status, {textContent: 'Preparing application 1 of 3: Captain (permanent, all genders) · Example City Airlines GmbH (about 20 s each)…'});
    const bounds = dialog.getBoundingClientRect();
    window.__uiProgress = {
      fits: status.scrollWidth <= status.clientWidth,
      barHeight: Math.round(document.getElementById('apply-progress').getBoundingClientRect().height),
      barBelowButtons: document.getElementById('apply-progress').getBoundingClientRect().top > dialog.querySelector('.actions').getBoundingClientRect().bottom,
      buttonsInside: [...dialog.querySelectorAll('.actions button')].every(button => {
        const box = button.getBoundingClientRect();
        return box.left >= bounds.left && box.right <= bounds.right;
      })
    };
    dialog.close();
    document.querySelector('.row-main').click();
    window.__uiSessions = document.getElementById('ss-list').textContent;
  } catch (error) { window.__uiError = error.stack; }`;
  const probe = `JSON.stringify({error: window.__uiError, progress: window.__uiProgress, jobs: window.__uiJobs, sessions: window.__uiSessions, view: document.querySelector('.view[data-view="sessions"]').hidden})`;
  const run = spawnSync(process.execPath, ['scripts/shot.mjs', 'jobs', '--js', setup, '--no-picture', '--eval', probe], {cwd: desktop, encoding: 'utf8', timeout: 60000});
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(JSON.parse(run.stdout.trim().split('\n').pop()));
  assert.equal(result.error, undefined, result.error);
  for (const [index, label] of ['Queued', 'Filling', 'Ready for review'].entries()) {
    assert.ok(result.jobs[index].text.includes(label), result.jobs[index].text);
    assert.equal(result.jobs[index].action, 'View session');
    assert.doesNotMatch(result.jobs[index].text, /📝 Kit|Kit ready|Application kit/);
  }
  assert.deepEqual(result.progress, {fits: true, barHeight: 8, barBelowButtons: true, buttonsInside: true});
  assert.equal(result.view, false, 'the action opens Sessions');
  assert.match(result.sessions, /Background automation/);
  assert.match(result.sessions, /Full automation/);
});
