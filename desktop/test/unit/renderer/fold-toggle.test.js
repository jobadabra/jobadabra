// The Show / Hide button of the Jobs folds (owner, 5 Nov 2026: "\"Show\" doesn't look like a button, but rather like a text"): one word source and one style for every `.jobs-fold`
// (Suggestions for your search, In conversation). The class loop reads the page: a fold added later without the toggle fails here.
import {readScreenSource} from '../../static-screen-source.js';
import '../../../i18n/screens-helpers.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {foldToggleWord} from '../../../renderer/fold-toggle.js';
import {jobsBarWords} from '../../../renderer/suggestions.js';
import {talkingBar} from '../../../renderer/jobs-view.js';

const read = file => readScreenSource(new URL(`../../../${file}`, import.meta.url), 'utf8');

test('Show when folded, Hide when open: the one word for every fold', () => {
  assert.equal(foldToggleWord(false), 'Show');
  assert.equal(foldToggleWord(true), 'Hide');
  assert.equal(jobsBarWords(3, false, 'x').detail, 'Show');
  assert.equal(jobsBarWords(3, true).detail, 'Hide');
  assert.equal(talkingBar([], false).toggle, 'Show');
  assert.equal(talkingBar([], true).toggle, 'Hide');
});

test('every .jobs-fold in the page has its fold-toggle in its summary, drawn by the shared style', () => {
  const html = read('renderer/index.html');
  const folds = [...html.matchAll(/<details class="card jobs-fold[^"]*" id="([^"]+)"[^>]*>\s*<summary>(.*?)<\/summary>/gs)];
  assert.deepEqual(folds.map(fold => fold[1]), ['jobs-suggestions', 'jobs-talking'], 'a new fold: add it here and give it the toggle');
  for (const [, id, summary] of folds) assert.match(summary, /<span class="fold-toggle" id="[^"]+"><\/span>$/, `${id}: the toggle is the summary's last part`);
  const css = read('renderer/style.css');
  assert.match(css, /\.fold-toggle \{[^}]*border: 1px solid var\(--line\)[^}]*background: var\(--surface\)/, 'the small secondary button\'s look');
  assert.match(css, /\.jobs-fold > summary:hover \.fold-toggle/, 'hover');
  assert.match(css, /\.jobs-fold > summary:focus-visible \.fold-toggle/, 'keyboard focus');
});

test('the severity circles are the sidebar badge, with a dark-theme mark that reads (WCAG AA 4.5 on each fill)', () => {
  const css = read('renderer/style.css');
  const tokens = read('renderer/tokens.css');
  assert.match(css, /\.nav-badge\.tone-bad \{ background: var\(--bad\)/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{ \.nav-badge:is\(\.tone-warn, \.tone-info, \.tone-bad\) \{ color: var\(--on-bright\); \} \}/);
  const dark = tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)'));
  const hex = name => dark.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))[1];
  const lum = color => { const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const fill of ['warn-bright', 'info', 'bad']) assert.ok(ratio(hex('on-bright'), hex(fill)) >= 4.5, `dark: the number on --${fill}`);
});
