// Settings → Your data after "Move my data to Notion" (renderer/store-move-text.js): what moved, and the texts Notion already had.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {movedText} from '../../../renderer/store-move-text.js';

test('what moved, in words, and each text Notion already had kept with where this Mac\'s went', () => {
  assert.equal(movedText({moved: {applications: 12, cron_runs: 40, insights: 0}, kept: ['profile'], archive: '/x/backup/moved'}),
    `Moved to Notion ✓ 12 applications, 40 runs. Your Notion already had a Profile, so it was kept; this ${process.platform === 'win32' ? 'PC' : 'Mac'}'s version is in /x/backup/moved.`);
  assert.equal(movedText({moved: {}, kept: []}), 'Moved to Notion ✓');
});

test('Windows store-move wording preserves personal archive paths verbatim', () => {
  const previous = globalThis.window;
  globalThis.window = {pilot: {platform: 'win32'}};
  try {
    const archive = '/fictional/this Mac/Keychain ⌘K {archive}';
    assert.equal(movedText({kept: ['profile'], archive}), `Moved to Notion ✓ Your Notion already had a Profile, so it was kept; this PC's version is in ${archive}.`);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
