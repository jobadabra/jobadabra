// The screens' one date format (renderer/date.js): "8 Oct", the year only when it isn't this year (owner, 9 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shortDay, savedAgo, runWhen} from '../../../renderer/date.js';
import {setLocale} from '../../../i18n/index.js';

const NOW = Date.parse('2026-10-09T10:00:00');

test('a date this year has no year, another year has it, and an unreadable value is empty', () => {
  assert.equal(shortDay('2026-10-08', NOW), '8 Oct');
  assert.equal(shortDay('2026-09-28T18:40:00+00:00', NOW), '28 Sept');
  assert.equal(shortDay('2025-03-01', NOW), '1 Mar 2025');
  assert.equal(shortDay('', NOW), '');
  assert.equal(shortDay('not a date', NOW), '');
});

test('short dates use the selected app language and preserve their calendar day', () => {
  setLocale('fr');
  assert.equal(shortDay('2026-10-08', NOW), new Date('2026-10-08T12:00:00').toLocaleDateString('fr', {day: 'numeric', month: 'short'}));
  setLocale('en');
});

test('shared timestamps use the selected language for today, dates and saved ages', () => {
  setLocale('ru');
  assert.equal(savedAgo('2026-10-09T09:57:00', NOW), '3 мин назад');
  const time = new Date(NOW).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'});
  assert.equal(runWhen(NOW, NOW), `Сегодня ${time}`);
  assert.match(runWhen('2026-09-08T10:00:00', NOW), /сент/);
  setLocale('en');
  assert.equal(savedAgo('2026-10-09T09:57:00', NOW), '3 min ago');
  assert.equal(savedAgo('2026-10-08T10:00:00', NOW), '1d ago');
});
