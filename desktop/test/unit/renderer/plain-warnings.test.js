// Known engine warnings read as what they mean, never the raw exception (owner, 6 Oct 2026: an employer search's box said
// "candidate source skipped: TimeoutError" and "KeyError: 'watch'"); the exact lines stay in the technical log.
import '../../../i18n/screens-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {groupWarnings} from '../../../renderer/run-warnings.js';

test("an employer search's two warnings in plain words", () => {
  assert.deepEqual(groupWarnings(['Warning: candidate source skipped: TimeoutError: The read operation timed out',
    "Warning: Notion not updated for KMU Informatikpartner AG: KeyError: 'watch'"]),
  ['One source could not be checked because it timed out.', 'The Notion update for KMU Informatikpartner AG failed.']);
});

test('any other line ending in a raw exception says what failed and where the details are', () => {
  assert.deepEqual(groupWarnings(["Warning: feed parse failed: ValueError: bad date"]), ['Feed parse failed (an internal error; details in the technical log).']);
});

test('localized warning summaries keep raw log text and unrecognized provider messages untouched', async () => {
  const {setLocale} = await import('../../../i18n/index.js');
  const {humanError, newDetails, runWarnings} = await import('../../../renderer/run-warnings.js');
  try {
    setLocale('ru');
    const raw = 'Warning: candidate source skipped: TimeoutError: The read operation timed out';
    assert.deepEqual(groupWarnings([raw]), ['Не удалось проверить один источник: истекло время ожидания.']);
    assert.deepEqual(runWarnings([raw]), ['candidate source skipped: TimeoutError: The read operation timed out']);
    assert.equal(humanError('Original external message'), 'Original external message');
    const busy = humanError('RateLimitError: 429');
    assert.equal(busy, 'сервис ИИ сейчас ограничивает запросы');
    assert.deepEqual(newDetails([busy]), []);
    const skipped = groupWarnings(['Skipped job J-1: RateLimitError: 429']);
    assert.deepEqual(newDetails(skipped), skipped, 'a skipped job remains actionable detail');
  } finally { setLocale('en'); }
});
