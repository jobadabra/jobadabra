// Serialize full repository updates and language-only writes for the same local profile.
const pending = new WeakMap();

/** Run one repository update after prior writes; a failed write never blocks the next normal update. */
export function serializeRepoUpdate(storage, update) {
  const next = (pending.get(storage) || Promise.resolve()).then(update);
  pending.set(storage, next.catch(() => undefined));
  return next;
}
