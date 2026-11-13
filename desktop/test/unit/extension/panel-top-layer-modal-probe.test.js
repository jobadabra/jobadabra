// The panel's pill-above-a-modal rule (review.js inModal) reads panel-top-layer.js's one :modal probe, so a DOM that cannot read :modal (Chrome before 105, a test's fake DOM)
// keeps the z-index fallback instead of throwing on every opening the panel does by itself.
// Why (#4104, Gitar): review.js called matches('dialog:modal') unguarded while panel-top-layer.js guarded its own copy; one probe now, false where :modal cannot be read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../../../../extension/panel-top-layer.js', import.meta.url), 'utf8');
const noModal = () => { throw new SyntaxError("':modal' is not a valid selector"); };

function topLayerOn(document) {
  const window = {};
  vm.runInNewContext(source, {window, document, MutationObserver: class { observe() {} }, getComputedStyle: () => ({position: 'static'})});
  return window.__jobadabraTopLayer;
}

test('on a DOM without :modal the top layer loads and isModal says false instead of throwing', () => {
  const root = {children: [], append() {}};
  const document = {
    documentElement: root, head: root,
    querySelectorAll: selector => (selector.includes(':modal') ? noModal() : []),
    getElementById: () => null, createElement: () => ({}), addEventListener() {},
  };
  const layer = topLayerOn(document);
  assert.equal(layer.parentNow(), root);
  assert.equal(layer.isModal({matches: noModal}), false);
  assert.equal(layer.isModal(null), false);
  assert.equal(layer.isModal({matches: selector => selector === 'dialog:modal'}), true);
});
