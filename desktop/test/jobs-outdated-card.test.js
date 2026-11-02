// Jobs, when the running app is older than its engine: the Restart card replaces the list (owner, 2 Nov 2026: "Jobs shows the restart card instead of a wrong list").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const make = id => Object.assign(globalThis.document.createElement('div'), {id});
const ids = ['jobs-outdated', 'jobs-split', 'jobs-head', 'jobs-empty', 'jobs-unscored'];

test('the card says what to do, restarts on its button, and takes the list away; a good read brings the list back', async () => {
  let restarted = 0;
  globalThis.window.pilot = {interviews: {relaunch: () => { restarted++; }}};
  body.replaceChildren(...ids.map(make));
  const {showOutdatedJobs, keepListHidden} = await import('../renderer/pages/jobs-outdated.js');
  const by = id => globalThis.document.getElementById(id);
  showOutdatedJobs(true);
  assert.equal(by('jobs-outdated').hidden, false);
  assert.match(by('jobs-outdated').textContent, /Jobadabra was updated while it was open\. Restart it to finish the update\./);
  assert.ok(['jobs-split', 'jobs-head', 'jobs-empty', 'jobs-unscored'].every(id => by(id).hidden === true), 'a stale list stays hidden');
  by('jobs-empty').hidden = false; by('jobs-unscored').hidden = false;   // a redraw of the list (renderJobs) unhid them
  keepListHidden();
  assert.ok(['jobs-split', 'jobs-head', 'jobs-empty', 'jobs-unscored'].every(id => by(id).hidden === true), 'a redraw does not bring the list back under the card');
  by('jobs-outdated').querySelector('button').click();
  assert.equal(restarted, 1);
  showOutdatedJobs(false);
  assert.equal(by('jobs-outdated').hidden, true);
  assert.ok(['jobs-split', 'jobs-head'].every(id => by(id).hidden === false));
});
