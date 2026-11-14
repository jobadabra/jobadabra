// "Add a job" and "Applied elsewhere" end in the job's drawer (owner, 13 Oct 2026; 14 Nov 2026: the dialog closes, a toast, the drawer opens): every add dialog uses linkToJob,
// which hands the job to afterAdded (renderer/pages/job-added.js, its behaviour: test/unit/renderer/job-added.test.js).
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = readScreenSource(new URL('../../../renderer/pages/jobs.js', import.meta.url), 'utf8');

test('each add dialog that gets a result with a job ends in linkToJob, and the helper opens the drawer', () => {
  const dialogs = [...readScreenSource(new URL('../../../renderer/index.html', import.meta.url), 'utf8').matchAll(/<dialog id="(import|applied)-dialog"/g)].map(m => m[1]);
  assert.deepEqual(dialogs.sort(), ['applied', 'import']);
  for (const name of dialogs) assert.match(source, new RegExp(`linkToJob\\('${name}-dialog', result, `), `${name} dialog links its result`);
  assert.match(source, /afterAdded\(\{dialog: \$\(dialogId\), job, openJob: openJobPanel/);
});

test('each call site passes its own toast title, and only Applied elsewhere\'s "not scored yet" keeps the dialog open', () => {
  const calls = [...source.matchAll(/linkToJob\('(\w+)-dialog', result, '([\w.]+)'(, true)?\)/g)].map(m => [m[1], m[2], Boolean(m[3])]);
  assert.deepEqual(calls, [['import', 'pagesJobsFinal.jobAdded', false], ['applied', 'pagesJobsFinal.applicationTracked', true], ['applied', 'pagesJobsFinal.applicationTracked', false]]);
  assert.match(source, /if \(\/not scored yet\/\.test\(result\.text\)\) \{[^}]*linkToJob\('applied-dialog', result, 'pagesJobsFinal\.applicationTracked', true\);\s*return;/, 'the stay call is inside the not-scored branch');
  assert.match(source, /say: \(\) => toastMessage\(t\(title\), result\.text/, 'the toast carries the call site\'s title and the result text');
  assert.match(source, /await loadJobs\(\)\.catch\(/, 'a failed list read does not stop the close and toast');
});
