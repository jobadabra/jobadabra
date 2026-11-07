// A dropdown named by aria-labelledby is named by that question, not by the floating "Please select" label drawn over it (7 Nov 2026, a XING step 2: "Which country do you live in?" was read
// as "Please select", the menu's own first option, so the answer was only proposed and the panel named the wrong field). Shape of the page: a heading with an id, a visible-but-aria-hidden
// <label for> holding the placeholder, a <select aria-labelledby=heading>. Two pages, one shape: the capture's own (neutral names) and a variant in another language with other ids and tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (install the app-core dev dependencies)';

const CAPTURE = `<form><div><h2 id="question-label-country">Which country do you live in?</h2><div><div>
  <label aria-hidden="true" for="menu-1">Please select</label>
  <select aria-labelledby="question-label-country" id="menu-1" name="standardQuestions.0.value"><option value="">Please select</option><option>Albania</option><option>Romania</option></select>
</div></div></div></form>`;
const VARIANT = `<form><section><p id="frage_7">In welchem Land wohnen Sie?</p><span aria-hidden="true"><label for="auswahl">Bitte wählen</label></span>
  <select id="auswahl" aria-labelledby="frage_7" name="f7"><option value="">Bitte wählen</option><option>Deutschland</option><option>Rumänien</option></select></section></form>`;
// The old rule stays where it was right: a native label names a box that has no aria-labelledby (an aria-label alone is not promoted over it: sites put generic words there), and an
// aria-labelledby that points at nothing falls back to the native label.
const PLAIN = `<form><label for="a">Phone</label><input id="a"><label for="b">Visible words</label><input id="b" aria-label="Generic input"><label for="c">Email</label><input id="c" aria-labelledby="nowhere"></form>`;

const nameOf = (window, selector) => window.__jobadabraFillKit.labelOf(window.document.querySelector(selector));

test('a dropdown named by aria-labelledby is read as its question, not as the aria-hidden placeholder label', { skip }, () => {
  assert.equal(nameOf(openPage(JSDOM, CAPTURE), 'select'), 'Which country do you live in?');
  assert.equal(nameOf(openPage(JSDOM, VARIANT), 'select'), 'In welchem Land wohnen Sie?');
});

test('a native label still names a box with no aria-labelledby, or one pointing at nothing', { skip }, () => {
  const window = openPage(JSDOM, PLAIN);
  assert.equal(nameOf(window, '#a'), 'Phone');
  assert.equal(nameOf(window, '#b'), 'Visible words');
  assert.equal(nameOf(window, '#c'), 'Email');
});

// The guards: a radio's or checkbox's label names the option (the option matcher reads exact names), and a box pointing at itself keeps its own label.
test('a radio, a checkbox and a box pointing at itself keep their native label', { skip }, () => {
  const window = openPage(JSDOM, `<form><p id="q">Do you need a visa?</p><input type="radio" id="r" name="v" aria-labelledby="q rl"><label id="rl" for="r">Yes</label>
    <input type="checkbox" id="c" aria-labelledby="q cl"><label id="cl" for="c">I agree</label><label for="s">Country</label><select id="s" aria-labelledby="s"><option>Albania</option></select></form>`);
  assert.equal(nameOf(window, '#r'), 'Yes');
  assert.equal(nameOf(window, '#c'), 'I agree');
  assert.equal(nameOf(window, '#s'), 'Country');
});
