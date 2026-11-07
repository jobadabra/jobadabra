// Setup steps: every switch in a step uses the standard .switch, and a finished setup shows no "Start" on Welcome.
import {readScreenSource} from '../../static-screen-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../renderer');
const html = readScreenSource(path.join(root, 'index.html'), 'utf8');
const steps = [...html.matchAll(/<div class="step" data-step="(\w+)">([\s\S]*?)(?=\n    <div class="step" data-step=|\n  <\/div>\n)/g)];

// Why (5 Nov 2026, #3282): .switch-row may be used here: it is the shared flex row now (components.css), no longer the Settings-only grid this test banned on 21 Oct 2026.
test('every checkbox inside a setup step sits in the standard .switch', () => {
  assert.ok(steps.length >= 4, 'found the setup steps');
  for (const [, name, body] of steps) {
    for (const box of body.matchAll(/<input type="checkbox"[^>]*>/g)) {
      const before = body.slice(Math.max(0, box.index - 40), box.index);
      assert.match(before, /class="switch">\s*$/, `${name}: ${box[0]} is not wrapped in <span class="switch">`);
    }
  }
});

test('a done setup: Welcome swaps Start for the done wording, and its banner is not shown on Welcome', () => {
  const wizard = readScreenSource(path.join(root, 'pages', 'wizard.js'), 'utf8');
  assert.match(wizard, /show\(\$\('review-mode'\), done && name !== 'welcome'\)/);
  const welcome = steps.find(([, name]) => name === 'welcome')[2];
  assert.match(welcome, /data-when="first"[^>]*>Start</);
  assert.match(welcome, /data-when="done" hidden>Review the steps</);
  for (const [, name, body] of steps) if (name !== 'welcome') assert.doesNotMatch(body, /data-when="first"/, `${name}: only Welcome has first-run wording`);
});
