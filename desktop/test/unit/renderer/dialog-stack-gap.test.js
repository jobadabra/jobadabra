// Parts stacked in a dialog sit one --stack-gap apart (owner 8 Nov 2026: "we're missing spacing. Let's add this to design system and to rules"): Log job activity's checkbox was flush under the text box, and its two composer tools had a curved divider fragment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const css = name => fs.readFileSync(new URL(`../../../renderer/${name}`, import.meta.url), 'utf8');
const rule = (text, selector) => text.split('\n').find(line => line.startsWith(selector)) || '';

test('the token exists and a check row after any part gets it, except inside a container with its own gap', () => {
  assert.match(css('tokens.css'), /--stack-gap: var\(--sp-3\)/);
  const stack = rule(css('components.css'), ':where(.panel-dialog) :not(.feedback-attach) > * + label.inline-label.check-row');
  assert.match(stack, /margin-top: var\(--stack-gap\)/);
  assert.ok(stack, 'the .feedback-attach grid already has a gap: a second one pushed Send off the window');
});

test('a divider between composer tools is straight: .tool has no radius', () => {
  assert.match(css('components.css'), /\.tool \{[^}]*border-radius: 0;/);
});

test('the design system says so: the gallery and the rules name the token', () => {
  assert.match(fs.readFileSync(new URL('../../../renderer/gallery.js', import.meta.url), 'utf8'), /var\(--stack-gap\)/);
  assert.match(fs.readFileSync(new URL('../../../../docs/rules/desktop-ui.md', import.meta.url), 'utf8'), /`--stack-gap` \(12\)/);
});
