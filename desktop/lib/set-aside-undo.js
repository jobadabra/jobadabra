// Undo for a value a pick set aside (lib/set-aside.js): a Profile fact is added back to its Your details section. The entry leaves the list only once
// the restore is written. Why (#3850, owner 12 Nov 2026: "Drop them" · "We should drop/delete the code"): Strategy's places no longer meet the Profile's,
// so a Locations entry an October pick set aside is no longer restored here (the Profile card lists only 'profile' entries,
// lib/details-facts-handlers.js). Guarded by test/unit/main/set-aside.test.js.
import {find, drop} from './set-aside.js';
import {restoreFact} from './profile-move.js';

/** Restores the set-aside Profile fact `id` and drops it from the list once written. -> {ok, error}. */
export async function undo(storage, id, {fetcher} = {}) {
  const entry = find(storage, id);
  if (!entry || entry.source !== 'profile') return {ok: false, error: 'That is no longer set aside'};
  const done = await restoreFact(storage, entry, {fetcher});
  if (done.ok) drop(storage, id);
  return done;
}
