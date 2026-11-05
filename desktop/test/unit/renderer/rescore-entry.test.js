// The Jobs bar's old-scores row and its severity bullets (owner, 5 Nov 2026: "let's move this into this card" · "add some bullets, for example: 1 red, 3 warnings/yellow, 4 info"):
// the row's shape, the one severity table (suggestions.js LOOK tones) every entry is counted by, and the bar's state that carries the bullets. Plain functions, no DOM.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RESCORE_KEY, rescoreEntries} from '../../../renderer/rescore-entry.js';
import {LOOK, SEVERITY, barView, bySeverity, entryParts, severityCounts, severityOf} from '../../../renderer/suggestions.js';
import {foldedLine, questionEntries} from '../../../renderer/question-entries.js';
import {noticeTitle, callHint} from '../../../renderer/rescore-words.js';

test('old scores are one row: the notice\'s own sentence, its hint, and the Re-score button with its count; none at 0 or while a re-score runs', () => {
  const [entry, ...more] = rescoreEntries({count: 10});
  assert.equal(more.length, 0);
  assert.equal(entry.key, RESCORE_KEY);
  assert.equal(entry.title, noticeTitle(10), 'the sentence Strategy says');
  assert.equal(entry.detail, callHint);
  assert.deepEqual(entry.actions, [{label: 'Re-score 10', do: 'rescore', count: 10}]);
  assert.deepEqual(entry.answers, [], 'no Not now: an old score is not a suggestion to dismiss');
  assert.equal(entry.blocking, false, 'a named row of the folded line, like the drawers\' rows');
  assert.equal(rescoreEntries({count: 100})[0].actions[0].label, 'Re-score 60 now', 'one press scores at most 60');
  assert.deepEqual(rescoreEntries({count: 0}), []);
  assert.deepEqual(rescoreEntries({count: 5, running: true}), [], 'while it runs its own card says so');
  assert.deepEqual(rescoreEntries(), []);
});

test('the folded line names the old scores among the drawers\' rows', () => {
  const rows = [...rescoreEntries({count: 10}), ...questionEntries({letter: {hint: 'x', setup: {}}, details: [1, 2, 3]})];
  assert.equal(foldedLine(bySeverity(rows), 3), '10 old scores · Cover letter missing · 3 details missing · 3 search suggestions'.replace('10 old scores · Cover letter missing', 'Cover letter missing · 10 old scores'));
  assert.equal(foldedLine(rescoreEntries({count: 1}), 0), '1 old score');
});

test('severity: one table, from each kind\'s tone; red is bad, yellow is warn, everything else (good too) reads as info', () => {
  assert.deepEqual(SEVERITY.map(item => item.key), ['bad', 'warn', 'info']);
  const kinds = {letter: 'bad', 'questions-error': 'bad', rescore: 'warn', details: 'warn', insight: 'warn', rejection: 'warn', visits: 'warn', learned: 'info', 'desktop-ai': 'info', week: 'info', hosted: 'info', skills: 'info'};
  for (const [kind, severity] of Object.entries(kinds)) assert.equal(severityOf({kind}), severity, kind);
  assert.equal(severityOf({kind: 'a-kind-nobody-wrote'}), 'info', 'an unknown kind is info, never a guess of red');
});

test('class loop: every kind the bar can draw has a severity from LOOK alone, and the bullets add up to the entries', () => {
  const entries = Object.keys(LOOK).map(kind => ({kind}));
  const counts = severityCounts(entries);
  assert.equal(counts.reduce((sum, item) => sum + item.count, 0), entries.length, 'no entry is counted twice or lost');
  for (const entry of entries) assert.ok(['bad', 'warn', 'info'].includes(severityOf(entry)), entry.kind);
  for (const [kind, look] of Object.entries(LOOK)) assert.equal(entryParts({kind, actions: []}).tone, look.tone, `${kind}: the row's edge and the bullet follow the same tone`);
});

test('the bullets: counts per severity, most severe first, the word in the text, none for an empty severity', () => {
  const entries = [{kind: 'letter'}, {kind: 'details'}, {kind: 'rescore'}, {kind: 'insight'}, {kind: 'learned'}, {kind: 'places'}, {kind: 'pay'}, {kind: 'ideas'}];
  assert.deepEqual(severityCounts(entries), [{key: 'bad', count: 1, text: '1 urgent'}, {key: 'warn', count: 3, text: '3 warnings'}, {key: 'info', count: 4, text: '4 info'}]);
  assert.deepEqual(severityCounts([{kind: 'learned'}]), [{key: 'info', count: 1, text: '1 info'}]);
  assert.deepEqual(severityCounts([]), []);
  assert.deepEqual(bySeverity([{kind: 'learned', n: 1}, {kind: 'letter', n: 2}, {kind: 'details', n: 3}, {kind: 'rescore', n: 4}]).map(item => item.n), [2, 3, 4, 1], 'red, then yellow in the order given, then blue');
});

test('the bar carries its bullets in each of its states (kept paint, Focus read) and shows none when there is nothing', () => {
  const entries = [...rescoreEntries({count: 4}), {kind: 'learned'}];
  const read = barView({focusRead: true, entries, line: 'x'});
  assert.deepEqual(read.bullets.map(item => `${item.key}:${item.count}`), ['warn:1', 'info:1']);
  const kept = barView({focusRead: false, kept: {shown: true, count: 2, line: 'x', bullets: read.bullets}});
  assert.deepEqual(kept.bullets, read.bullets, 'the kept paint draws the same bullets, so nothing moves when Focus is read');
  assert.deepEqual(barView({focusRead: false, kept: {shown: true, count: 1, line: 'old'}}).bullets, [], 'a kept bar from before the bullets existed draws none');
  assert.deepEqual(barView({focusRead: true, entries: []}).bullets, []);
});
