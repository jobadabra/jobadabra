// A check row below another part of a dialog sits one --stack-gap under it (owner 8 Nov 2026: "we're missing spacing. Let's add this to design system and to rules"): Log job activity's checkbox was flush under the text box, and its two composer tools had a curved divider fragment.
// Reads the real markup and CSS text: no browser here, so this plays the owner's dialog structure against the rule's selector, not a rendered pixel.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../../../renderer/index.html'), components = read('../../../renderer/components.css');
const dialog = id => html.slice(html.indexOf(`<dialog id="${id}"`), html.indexOf('</dialog>', html.indexOf(`<dialog id="${id}"`)));

test('the token exists and the rule gives a check row below another part the gap', () => {
  assert.match(read('../../../renderer/tokens.css'), /--stack-gap: var\(--sp-3\)/);
  const rule = components.split('\n').find(line => line.startsWith(':where(.panel-dialog) :not(.feedback-attach) > * + label.inline-label.check-row'));
  assert.match(rule || '', /margin-top: var\(--stack-gap\)/);
});

test('Log job activity: its checkbox is a check-row inline-label with a part before it, inside a panel-dialog form, not inside a gap container', () => {
  const lead = dialog('lead-dialog');
  assert.match(html, /<dialog id="lead-dialog" class="panel-dialog">/);
  assert.match(lead, /<div id="lead-shots" hidden><\/div>\s*(<!--[\s\S]*?-->\s*)?<label class="check-row inline-label" id="lead-auto-row">/, 'the rule matches `* + label.inline-label.check-row`: a sibling part must come first');
  assert.doesNotMatch(lead, /feedback-attach/);
});

test('Send feedback keeps its own gap: every check row in it sits inside .feedback-attach, which the rule skips', () => {
  const feedback = dialog('app-feedback-dialog');
  const attach = feedback.slice(feedback.indexOf('class="feedback-attach"'));
  const rows = id => (feedback.match(new RegExp(`<label class="check-row inline-label"><input type="checkbox" id="app-feedback-include-${id}"`, 'g')) || []).length;
  for (const id of ['shot', 'page', 'logs', 'profile']) assert.equal(rows(id), 1);
  assert.equal((attach.match(/class="check-row inline-label"/g) || []).length, 4, 'all four rows follow the .feedback-attach opening');
  assert.match(read('../../../renderer/style.css'), /\.feedback-attach \{ display: grid; gap: var\(--sp-2\)/, 'the reason the rule skips it: it already has its own gap');
});

test('a divider between composer tools is straight: .tool has no radius', () => {
  assert.match(components, /\.tool \{[^}]*border-radius: 0;/);
});

test('the design system says so: the gallery and the rules name the token', () => {
  assert.match(read('../../../renderer/gallery.js'), /var\(--stack-gap\)/);
  assert.match(read('../../../../docs/rules/desktop-ui.md'), /`--stack-gap` \(12\)/);
});

test('the gallery still parses: a quote inside its section note once broke the whole design-system page', () => {
  const parsed = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('../../../renderer/gallery.js', import.meta.url))], {encoding: 'utf8'});
  assert.equal(parsed.status, 0, parsed.stderr);
});
