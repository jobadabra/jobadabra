// The bottom bar and the Find jobs header showed "Run counts: looked=61300 matches=17 scored=5 g…" (#3923, 12 Nov 2026): the engine's machine lines are
// the Find card's numbers, never words for a person. stepWords/searchPhase say nothing for them; the app keeps the last readable step (test/unit/main/progress-step.test.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();   // Why (#3923): the pages start timers at import; they must not hold the test open
install();
const doc = globalThis.document, found = doc.getElementById.bind(doc);
doc.getElementById = id => {
  let node = found(id);
  if (!node) { node = doc.createElement('div'); node.id = id; doc.body.append(node); }
  return node;
};
globalThis.window.dispatchEvent = () => true;
globalThis.Event ??= class { constructor(type) { this.type = type; } };
globalThis.window.pilot = new Proxy({}, {get: () => async () => null});
const {stepWords, searchPhase} = await import('../../../renderer/pages/activity-basics.js');

test('a machine line is no step words, whatever its size', () => {
  for (const line of ['Run counts: looked=1 matches=1 scored=1 good=1', 'Run counts: looked=61300 matches=17 scored=5 good=2', 'Stages: EURES read 200 · kept 40 · ai_no 60', 'Stage: EURES read https://example.com/job/1']) {
    assert.equal(stepWords(line), '', line);
    assert.equal(searchPhase(line), '', line);
  }
});
test('a readable step still reads as before', () => {
  assert.equal(stepWords('Scoring 12 jobs'), 'Scoring 12 jobs');
  assert.equal(stepWords('Scored 3 of 9 job(s) with claude-sonnet-5-5; 0 failed'), searchPhase('Scored 3 of 9 job(s)'));
});
