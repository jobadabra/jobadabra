// The one-time move of the older Strategy work rights into Profile → Work eligibility (owner, 12 Nov 2026, #3850: "Work rights doesn't really make sense.
// They should be only in the Profile"). Each right is added as an older Work eligibility line; the fold that already runs when Your details opens
// (lib/eligibility-settle.js: a backup first, Undo after, an answered zone never overwritten) reads it into Nationality and the zones, and a right that fits
// none of them is dropped there (owner, asked via AskUserQuestion: "Drop it"). Copy first; read back. Guarded by test/unit/main/work-rights.test.js.
import * as sections from './profile-sections.js';
import {saveCopy} from './profile-move.js';
import {olderRights} from './work-rights.js';

// The label the older lines carry: the words the Strategy field used, so the fold's AI reads what they were.
export const LABEL = 'Where I can work without a visa';

/**
 * Moves the older Strategy rights into Work eligibility once. -> the count of lines added (0 when moved before, none to move, or all already there).
 * Invariants: runs once (settings.workRightsMovedAt); a right already on the page is not added twice; nothing is removed; the copy runs before the write.
 */
export async function moveRights(storage, {fetcher, copy = saveCopy, now = new Date()} = {}) {
  if (storage.settings().workRightsMovedAt) return 0;
  const older = olderRights(storage);
  const lines = (await sections.read(storage, fetcher)).eligibility || [];
  const have = new Set(lines.map(line => String(line.value ?? '').trim().toLowerCase()));
  const added = older.filter(right => !have.has(right.toLowerCase())).map(right => ({label: LABEL, value: right}));
  if (added.length) {
    await copy(storage, {fetcher, now});
    await sections.save(storage, 'eligibility', [...lines, ...added], fetcher);
    const back = ((await sections.read(storage, fetcher)).eligibility || []).map(line => String(line.value ?? '').trim().toLowerCase());
    if (added.some(line => !back.includes(line.value.toLowerCase()))) throw new Error('Your work rights did not move into Work eligibility; nothing else changed');
  }
  storage.saveSettings({workRightsMovedAt: now.toISOString()});
  return added.length;
}
