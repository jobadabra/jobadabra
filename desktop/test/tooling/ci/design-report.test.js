// The PR's Design system report: one line when everything passes, a table of only the failing cells otherwise.
// Guard: release — tools/design-table-check.py reads this block's first line to let a desktop PR through; without it a ⛔ report could print as a pass, or a pass stop printing its sha.
import assert from 'node:assert/strict';
import test from 'node:test';
import {RULES, renderReport} from '../../../scripts/design-table.mjs';

const hit = (rule, at, note = '') => ({rule, at, note});
const run = (screen, width, theme, base, head) => ({screen, width, theme, base, head});
const SCREENS = ['focus', 'jobs'].flatMap(screen => [640, 1100].map(width => [screen, width]));
const everyRun = (base, head) => SCREENS.flatMap(([screen, width]) => ['light', 'dark'].map(theme => run(screen, width, theme, base, head)));

test('all passing is exactly one line naming the commit and the screens, with no table', () => {
  const {report, failed} = renderReport(everyRun([], []), 'abc1234');
  assert.equal(failed, false);
  assert.equal(report, `**Design system (measured on abc1234)** ✅ all ${RULES.length} rules pass on 4 screens`);
});

test('a rule whose count moved gets a vs-main line, only that rule; a violation main already has stays quiet', () => {
  const old = hit('spacing', 'div.card', 'gap 13px');
  const ghosts = n => Array.from({length: n}, (_, i) => hit('ghost', `button.g${i}`, 'Skip'));
  const {report, failed} = renderReport(everyRun([old, ...ghosts(3)], [old, ...ghosts(1)]), 'abc1234');
  assert.equal(failed, false);
  assert.deepEqual(report.split('\n'), ['**Design system (measured on abc1234)** ✅ all 6 rules pass on 4 screens', 'vs main: ghost 24 → 8 ▼16']);
});

test('two new problems give a verdict of 2 and a table of exactly 2 rows, each with its count and what', () => {
  const runs = everyRun([], []);
  const jobs640 = runs.filter(r => r.screen === 'jobs' && r.width === 640);
  for (const r of jobs640) r.head = [hit('spacing', 'div.card', 'gap 13px'), hit('spacing', 'div.card', 'gap 7px'), hit('spacing', 'div.row', 'gap 22px')];
  const focus1100 = runs.filter(r => r.screen === 'focus' && r.width === 1100);
  focus1100[0].head = [hit('primary', 'section#up-next', '2 primary buttons')];   // one theme only
  const {report, failed} = renderReport(runs, 'abc1234');
  assert.equal(failed, true);
  const lines = report.split('\n');
  assert.equal(lines[0], '**Design system (measured on abc1234)** ⛔ 4 new problems');
  assert.equal(lines[1], 'vs main: spacing 0 → 6 ▲6 · primary 0 → 1 ▲1');   // counts are per render: 3 hits x light and dark
  const rows = lines.filter(l => l.startsWith('| ') && !l.startsWith('| Rule'));
  assert.deepEqual(rows, [
    '| Spacing scale | jobs 640 | +3 | `div.card` gap 13px; `div.card` gap 7px; `div.row` gap 22px |',
    '| 1 primary / card | focus 1100 | +1 | `section#up-next` 2 primary buttons (light) |',
  ]);
});

test('a problem the base render already has is not new, and a pipe in a note cannot split the row', () => {
  const same = hit('clipped', 'span.tile', 'cut');
  assert.equal(renderReport([run('jobs', 640, 'light', [same], [same])], 'abc1234').failed, false);
  const {report} = renderReport([run('jobs', 640, 'light', [same], [same, hit('clipped', 'span.tile', 'a | b')])], 'abc1234');
  assert.match(report, /^\| Nothing clipped \| jobs 640 \| \+1 \| `span.tile` a \/ b \(light\) \|$/m);
});
