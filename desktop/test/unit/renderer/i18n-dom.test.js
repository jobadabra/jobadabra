// Explicit translation bindings preserve unmarked personal content and nested controls.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';
import {registerMessages, setLocale} from '../../../i18n/index.js';
import {translate} from '../../../renderer/i18n-dom.js';

test('only marked text and attributes change, including the root itself', () => {
  const body = install({realNodeLists: true});
  const {document} = globalThis;
  registerMessages('de', 'dom', {label: 'Sprache', hint: 'Sprache wählen'}); setLocale('de');
  const button = document.createElement('button'), icon = document.createElement('i'), text = document.createElement('span');
  text.setAttribute('data-i18n', 'dom.label'); text.dataset.i18n = 'dom.label'; text.textContent = 'Language';
  button.setAttribute('data-i18n-title', 'dom.hint'); button.dataset.i18nTitle = 'dom.hint'; button.append(icon, text);
  const cv = document.createElement('p'); cv.textContent = '<b>My Mac experience {name}</b>';
  body.append(button, cv);
  translate(body); translate(text);
  assert.equal(text.textContent, 'Sprache');
  assert.equal(button.getAttribute('title'), 'Sprache wählen');
  assert.equal(button.children[0], icon);
  assert.equal(cv.textContent, '<b>My Mac experience {name}</b>');
  setLocale('en');
});
