// Guard: data — portable authored UI copy changes displayed fields while canonical payloads/actions and raw values remain unchanged.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerMessages, setLocale} from '../../../i18n/index.js';
import {copyMessage, copyFields, copyField} from '../../../i18n/display-copy.js';

test('portable copy resolves at paint time, preserving canonical payload/action values and English-looking raw data', () => {
  registerMessages('de', 'focusCards', {testReply: 'Antwort an {who}', testToday: 'heute'});
  const raw = 'Apply to your next role. {who} <raw>';
  const source = copyFields({title: 'Reply to ' + raw, kind: 'reply', action: {do: 'reply', value: raw}},
    {title: copyMessage('focusCards.testReply', 'Reply to ' + raw, {who: raw})});
  const before = JSON.stringify(source);
  setLocale('de');
  assert.equal(copyField(source, 'title'), 'Antwort an ' + raw);
  assert.equal(source.title, 'Reply to ' + raw);
  assert.equal(JSON.stringify(source), before);
  assert.equal(copyField({title: raw}, 'title'), raw);
  setLocale('en');
  assert.equal(copyField(source, 'title'), source.title);
});

test('JSON survives cache transport; only known authored descriptors are read, including nested and list fields', () => {
  setLocale('de');
  const payload = {meta: ['today', 'Raw English'], displayCopy: {meta: {list: [
    {key: 'focusCards.testToday', fallback: 'today', values: {}}, {value: 'Raw English'}]}}};
  assert.deepEqual(copyField(JSON.parse(JSON.stringify(payload)), 'meta'), ['heute', 'Raw English']);
  assert.equal(copyField({title: 'Raw', displayCopy: {title: {key: 'untrusted.other', fallback: 'Changed', values: {}}}}, 'title'), 'Raw');
  setLocale('en');
});
