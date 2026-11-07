// In-process display descriptors preserve diagnostic payloads and private values while resolving UI text at invocation time.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {displayText, withDisplay, transferDisplay} from '../../../i18n/display-values.js';
import {registerMessages, setLocale} from '../../../i18n/index.js';

registerMessages('en', 'displayContract', {saved: 'Saved: {name}'});
registerMessages('de', 'displayContract', {saved: 'Gespeichert: {name}'});
registerMessages('ru', 'displayContract', {saved: 'Сохранено: {name}'});
afterEach(() => setLocale('en'));

test('an intentional result wrapper inherits private display metadata without changing either wire object', () => {
  const source = Object.freeze({ok: false, error: 'canonical failure'});
  const target = Object.freeze({...source, mode: 'mail'});
  const sourceWire = JSON.stringify(source), targetWire = JSON.stringify(target);
  withDisplay(source, 'displayContract.saved', {name: 'Fictional {name}'});
  assert.equal(transferDisplay(source, target), target);
  setLocale('de');
  assert.equal(displayText(target, target.error), 'Gespeichert: Fictional {name}');
  setLocale('ru');
  assert.equal(displayText(target, target.error), 'Сохранено: Fictional {name}');
  assert.equal(displayText(source, source.error), 'Сохранено: Fictional {name}');
  assert.equal(JSON.stringify(source), sourceWire);
  assert.equal(JSON.stringify(target), targetWire);
  assert.deepEqual(Reflect.ownKeys(target), ['ok', 'error', 'mode']);
});

test('an untagged source leaves raw results and an existing target presentation intact', () => {
  const source = Object.freeze({error: 'raw upstream detail'}), target = Object.freeze({...source});
  assert.equal(transferDisplay(source, target), target);
  assert.equal(displayText(target, target.error), source.error);
  withDisplay(target, 'displayContract.saved', {name: 'Existing'});
  transferDisplay(source, target);
  setLocale('de');
  assert.equal(displayText(target, target.error), 'Gespeichert: Existing');
});

test('a frozen failure keeps exact identity and wire payload while only its UI presentation localizes', () => {
  const value = Object.freeze({ok: false, error: 'canonical diagnostic', status: 503});
  const before = JSON.stringify(value), fields = Reflect.ownKeys(value);
  const raw = 'Fictional private this Mac Keychain ⌘K {name}';
  assert.equal(withDisplay(value, 'displayContract.saved', {name: raw}), value);
  setLocale('de');
  assert.equal(displayText(value, value.error), `Gespeichert: ${raw}`);
  setLocale('ru');
  assert.equal(displayText(value, value.error), `Сохранено: ${raw}`);
  assert.equal(JSON.stringify(value), before);
  assert.deepEqual(Reflect.ownKeys(value), fields);
  assert.equal(value.error, 'canonical diagnostic');
  assert.equal(before.includes(raw), false, 'private descriptor variables never become wire fields');
});

test('a real Error keeps its diagnostic message, stack and own fields', () => {
  const error = new Error('original provider-style diagnostic');
  const fields = Reflect.ownKeys(error), stack = error.stack;
  withDisplay(error, 'displayContract.saved', {name: 'Fictional result'});
  setLocale('ru');
  assert.equal(displayText(error, error.message), 'Сохранено: Fictional result');
  assert.equal(error.message, 'original provider-style diagnostic');
  assert.equal(error.stack, stack);
  assert.deepEqual(Reflect.ownKeys(error), fields);
  assert.equal(JSON.stringify(error), '{}');
});

test('untyped external errors and unknown bundled keys retain the exact supplied fallback', () => {
  const raw = 'Fictional upstream this Mac Keychain ⌘K {error}';
  const value = {ok: false, error: raw};
  setLocale('ru');
  assert.equal(displayText(value, value.error), raw);
  withDisplay(value, 'displayContract.unregistered', {name: 'must not appear'});
  assert.equal(displayText(value, value.error), raw);
});

test('a missing display locale inherits the existing English catalog without rewriting inserted values', () => {
  registerMessages('en', 'displayContract', {englishOnly: 'English: {raw}'});
  const value = {}, raw = 'Fictional this Mac Keychain ⌘K {raw}';
  withDisplay(value, 'displayContract.englishOnly', {raw});
  setLocale('fr');
  assert.equal(displayText(value, 'canonical fallback'), `English: ${raw}`);
});
