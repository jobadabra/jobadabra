// Reopening tester feedback starts an empty bug report with the default severity.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

const body = install();
for (const id of ['app-feedback-tester', 'app-feedback-person', 'app-feedback-text', 'app-feedback-tester-journey', 'app-feedback-tester-expected',
  'app-feedback-tester-seen', 'app-feedback-tester-steps', 'app-feedback-tester-severity']) {
  const field = globalThis.document.createElement('input');
  field.id = id;
  body.append(field);
}
globalThis.window.pilot.state = async () => ({settings: {}, secrets: {}});
const {drawTester, readTester} = await import('../../../renderer/pages/app-feedback-tester.js');

test('opening a new tester bundle clears the last report and resets severity', () => {
  drawTester('persona');
  for (const id of ['journey', 'expected', 'seen', 'steps']) globalThis.document.getElementById(`app-feedback-tester-${id}`).value = `old ${id}`;
  globalThis.document.getElementById('app-feedback-tester-severity').value = 'high';

  drawTester('desktop-tester');

  for (const id of ['journey', 'expected', 'seen', 'steps']) assert.equal(globalThis.document.getElementById(`app-feedback-tester-${id}`).value, '', `${id} starts empty`);
  assert.equal(globalThis.document.getElementById('app-feedback-tester-severity').value, 'medium');
  assert.equal(readTester().severity, 'medium');
});
