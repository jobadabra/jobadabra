// A language answer that names its languages draws one row per language, its name beside its own level chips (#3224: only A1..native showed, the names were in "Saved as").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
const {formatFor} = await import('../../../renderer/question-kind.js');
const {answerControl} = await import('../../../renderer/question-control.js');
const draw = (value, seen = []) => answerControl(formatFor({marked: {kind: 'language'}}), value, next => seen.push(next));
const names = node => node.querySelectorAll('.qa-language-name').map(each => each.textContent);
const press = (row, level) => row.querySelectorAll('button').find(button => button.textContent === level).listeners.click.forEach(fn => fn({}));

test('a line with three languages shows the three names, each with the level it was saved with', () => {
  const node = draw('English (native), Swahili (native), French (A2)');
  assert.deepEqual(names(node), ['English', 'Swahili', 'French']);
  const rows = node.querySelectorAll('.qa-language');
  assert.deepEqual(rows.map(row => row.querySelectorAll('button.is-active').map(button => button.textContent)), [['native'], ['native'], ['A2']]);
  assert.equal(node.value, 'English (native), Swahili (native), French (A2)', 'nothing is rewritten until a level is picked');
  assert.equal(node.complete, true);
});

test('picking a level changes that language only; the others stay as written', () => {
  const seen = [], node = draw('English (native), Swahili (native), French (A2)', seen);
  press(node.querySelectorAll('.qa-language')[2], 'B1');
  assert.equal(seen.at(-1), 'English (native); Swahili (native); French: B1');
  assert.equal(node.value, seen.at(-1));
});

test('one level for one unnamed answer stays the plain chips, with no language row', () => {
  const node = draw('B2');
  assert.deepEqual(names(node), []);
  assert.equal(node.value, 'B2');
});

test('the review queue\'s one-language question keeps the plain chips, whatever the level was written as (code-review: it could not be confirmed)', () => {
  const seen = [];
  const node = answerControl({...formatFor({marked: {kind: 'language'}}), single: true}, 'Fluent (business)', next => seen.push(next));
  assert.deepEqual(names(node), []);
  press(node, 'B2');
  assert.equal(seen.at(-1), 'B2', 'the answer is the level alone; the queue writes it back into that language\'s part');
});

test('free words that only look like a language part stay as written, not a row that would cut them', () => {
  const node = draw('English (native) and French (B1)');
  assert.deepEqual(names(node), []);
  assert.equal(node.value, 'English (native) and French (B1)');
});

test('pressing the level already shown rewrites nothing', () => {
  const seen = [], node = draw('English (native), French (A2)', seen);
  press(node.querySelectorAll('.qa-language')[0], 'native');
  assert.deepEqual(seen, []);
  assert.equal(node.value, 'English (native), French (A2)');
});
