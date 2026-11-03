// Jobs, when the running app is older than its engine: the Restart card replaces the list (owner, 2 Nov 2026: "Jobs shows the restart card instead of a wrong list").
// One owner: <body data-jobs-outdated>; style.css hides every list element under it (Gitar on #3015: a hide call that must run after paintViews was a trap).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

const body = install();
const make = id => Object.assign(globalThis.document.createElement('div'), {id});

test('the card says what to do, restarts on its button, and sets the one state the style reads; a good read clears it', async () => {
  let restarted = 0;
  globalThis.window.pilot = {interviews: {relaunch: () => { restarted++; }}};
  body.replaceChildren(make('jobs-outdated'));
  const {showOutdatedJobs} = await import('../../../renderer/pages/jobs-outdated.js');
  const card = globalThis.document.getElementById('jobs-outdated');
  showOutdatedJobs(true);
  assert.equal(card.hidden, false);
  assert.match(card.textContent, /Jobadabra was updated while it was open\. Restart it to finish the update\./);
  assert.equal(globalThis.document.body.dataset.jobsOutdated, '1');
  card.querySelector('button').click();
  assert.equal(restarted, 1);
  showOutdatedJobs(false);
  assert.equal(card.hidden, true);
  assert.equal(globalThis.document.body.dataset.jobsOutdated, undefined);
});

test('class: the style hides every jobs-* element the Jobs renderer shows or hides, so no redraw order brings the list back under the card', () => {
  const css = fs.readFileSync(new URL('../../../renderer/style.css', import.meta.url), 'utf8');
  const rule = /body\[data-jobs-outdated\] :is\(([^)]*)\)\s*\{\s*display:\s*none\s*!important/.exec(css)?.[1] || '';
  const hidden = new Set(rule.split(',').map(part => part.trim().replace(/^#/, '')));
  const shown = new Set();
  for (const file of ['jobs-views.js', 'jobs-render.js', 'jobs.js']) {
    const source = fs.readFileSync(new URL(`../../../renderer/pages/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\$\('(jobs-(?:split|head|board|empty|unscored|count|more|stuck|filter))'\)(?:\.hidden|[,)])/g)) shown.add(match[1]);
    for (const match of source.matchAll(/show\(\$\('(jobs-[a-z]+)'\)/g)) shown.add(match[1]);
  }
  assert.ok(shown.size >= 4, `found ${[...shown]}`);
  for (const id of shown) assert.ok(hidden.has(id), `#${id} is shown by the renderer but not hidden under the card`);
});
