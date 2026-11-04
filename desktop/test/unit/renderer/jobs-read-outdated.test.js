// The engine refuses a run started by an app older than it (src/paths.py OUTDATED_APP): the Jobs read says so in the one restart line (renderer/errors.js), never "Could not read the job list".
// Owner scenario, 2 Nov 2026: Jobadabra open since before the rename; the engine read the checkout's folders and Jobs listed 212 jobs with no score.
import test from 'node:test';
import assert from 'node:assert/strict';
import {jobs} from '../../../lib/pipeline-commands.js';
import {install} from '../../tiny-dom.js';

install();
const {OUTDATED_LINE, isOutdated} = await import('../../../renderer/errors.js');
const storage = {settings: () => ({lastSearchAt: 'x'})};

test('a refused engine run ends the Jobs read with the restart line', async () => {
  const refused = async (_storage, _args, onLine) => { onLine('Jobadabra was updated while it was open. Restart it to finish the update.'); return {code: 1, stdout: ''}; };
  await assert.rejects(jobs(storage, 7001, refused), error => error.message === OUTDATED_LINE && isOutdated(error));
});

test('any other failed read keeps its own words', async () => {
  await assert.rejects(jobs(storage, 7002, async () => ({code: 1, stdout: ''})), /Could not read the job list/);
});

test('through the window, Electron wraps the line: it is still recognised', () => {
  assert.ok(isOutdated(new Error(`Error invoking remote method 'jobs': Error: ${OUTDATED_LINE}`)));
  assert.ok(!isOutdated(new Error("Error invoking remote method 'jobs': Error: Could not read the job list")));
});
