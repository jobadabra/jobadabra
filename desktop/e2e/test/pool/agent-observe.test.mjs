// The "tree or text" measurement of the AI user agent's spike (lib/agent-observe.mjs): both views are counted the same way, an unnamed control is counted apart, and the session line says what a session cost.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {approxTokens, compareViews, formatComparison, formatTierProbe, sessionLine, textControls, treeControls} from '../../lib/agent-observe.mjs';

const TREE = `- heading "Jobs" [level=1]
- button "Sort by name"
- button
- link "Open job" [ref=e4]:
  - /url: #job/1
- textbox "Search"
- combobox
- paragraph: No jobs yet`;
const TEXT = `Page: jobs

Visible text:
Jobs

Controls (index · kind · label):
0 · button · Sort by name
1 · button · (no label)
2 · field · Search`;

test('controls of the accessibility snapshot: named and unnamed, headings and text are not controls', () => {
  assert.deepEqual(treeControls(TREE), {named: 3, unnamed: 2});
  assert.deepEqual(treeControls(''), {named: 0, unnamed: 0});
  assert.deepEqual(treeControls(undefined), {named: 0, unnamed: 0});
});

test('controls of the explorer text view: a control with no label is unnamed', () => {
  assert.deepEqual(textControls(TEXT), {named: 2, unnamed: 1});
});

test('a view is compared on tokens, milliseconds and named controls per 1k tokens, and the totals add up', () => {
  const comparison = compareViews([{view: 'jobs', text: TEXT, tree: TREE, textMs: 30, treeMs: 80}, {view: 'focus', text: 'x'.repeat(400), tree: '', textMs: 10, treeMs: 20}]);
  const jobs = comparison.views[0];
  assert.equal(jobs.text.tokens, approxTokens(TEXT));
  assert.deepEqual([jobs.text.named, jobs.text.unnamed, jobs.tree.named, jobs.tree.unnamed], [2, 1, 3, 2]);
  assert.equal(jobs.tree.namedPer1kTokens, Number(((3 * 1000) / approxTokens(TREE)).toFixed(1)));
  assert.equal(comparison.totals.text.tokens, approxTokens(TEXT) + 100);
  assert.equal(comparison.totals.tree.ms, 100);
  assert.match(formatComparison(comparison), /^view · explorer text \| accessibility snapshot\njobs +/);
  assert.match(formatComparison(comparison), /\nALL +/);
});

test('the session line says calls, tokens, minutes, who answered and what each tier cost per call', () => {
  const trace = [{engine: 'codex'}, {engine: 'codex'}, {engine: 'claude'}, {engine: ''}];
  const spent = {calls: 4, input: 4000, output: 400, ms: 30000, tiers: {small: {calls: 3, input: 3000, output: 300, ms: 21000}, mid: {calls: 1, input: 1000, output: 100, ms: 9000}}};
  assert.equal(sessionLine({spent, trace}, 90000), 'this session: 4 calls, 4400 tokens, 1.5 min, engines codex 50% · claude 25% (small: 3 calls, 1100 tokens and 7.0 s per call; mid: 1 calls, 1100 tokens and 9.0 s per call)');
  assert.match(sessionLine({spent: {calls: 0, input: 0, output: 0, ms: 0, tiers: {}}, trace: []}, 0), /^this session: 0 calls, 0 tokens, 0.0 min$/);
});

test('the tier probe says tokens and seconds per call for each tier, and who answered', () => {
  const rows = [{tier: 'small', engine: 'codex', ms: 6000, input: 900, output: 100, action: 'click'}, {tier: 'small', engine: 'codex', ms: 8000, input: 900, output: 100, action: 'click'},
    {tier: 'mid', engine: 'claude', ms: 20000, input: 1200, output: 300, action: 'go'}];
  assert.equal(formatTierProbe(rows), ['tier probe (the same screen, asked on each tier)', 'small  2 calls  1000 tokens  7.0 s per call  answered by codex  actions: click, click',
    'mid    1 calls  1500 tokens  20.0 s per call  answered by claude  actions: go'].join('\n'));
});
