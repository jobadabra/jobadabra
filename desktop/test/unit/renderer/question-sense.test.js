// The pure rules of renderer/question-sense.js: a value that is its own label (or another's) is no answer, a line with no label has no question, a question that only repeats
// its label is no question. And the language parts of renderer/question-values.js the per-language question reads.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hasLabel, isBareLabel, labelAsValue, sameWords} from '../../../renderer/question-sense.js';
import {languageParts, needsCheck, withLevel} from '../../../renderer/question-values.js';

test('labelAsValue: its own label, another label, ignoring case, colon, star and spacing', () => {
  assert.equal(labelAsValue('Summary', 'Summary'), true);
  assert.equal(labelAsValue('Formation & qualifications professionnelles', ' formation & qualifications  professionnelles: '), true);
  assert.equal(labelAsValue('Education', 'Key Skills', ['Summary', 'Key Skills']), true, 'another label of the same set');
  assert.equal(labelAsValue('Workload', '80–100%'), false);
  assert.equal(labelAsValue('Summary', ''), false, 'an empty value is not a label');
});

test('hasLabel and isBareLabel', () => {
  assert.equal(hasLabel(''), false);
  assert.equal(hasLabel('  *: '), false);
  assert.equal(hasLabel('Workload'), true);
  assert.equal(isBareLabel('Workload', 'Workload'), true);
  assert.equal(isBareLabel('Workload:', 'workload'), true);
  assert.equal(isBareLabel('Need visa sponsorship?', 'Need visa sponsorship?'), false, 'a label that already asks is a question');
  assert.equal(isBareLabel('What workload do you want?', 'Workload'), false);
  assert.equal(sameWords('', ''), false);
});

test('language parts: one per language, in either writing; a part is exact only with one of the levels', () => {
  assert.deepEqual(languageParts('Romanian: Native; English: Fluent; French: B1').map(part => [part.name, part.level]), [['Romanian', 'Native'], ['English', 'Fluent'], ['French', 'B1']]);
  assert.deepEqual(languageParts('Romanian (native), English (fluent)').map(part => [part.name, part.level]), [['Romanian', 'native'], ['English', 'fluent']]);
  assert.equal(needsCheck('language', 'Romanian: Native; English: Fluent'), true);
  assert.equal(needsCheck('language', 'Romanian: Native; French: B1'), false, 'every part exact: nothing to check');
  assert.equal(needsCheck('language', 'B2'), false, 'one level under a language label stays exact');
  assert.equal(needsCheck('language', 'Fluent'), true);
  assert.equal(withLevel('Romanian: Native; English: Fluent', 1, 'C1'), 'Romanian: Native; English: C1');
});
