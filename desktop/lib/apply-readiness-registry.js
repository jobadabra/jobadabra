// Where every handler group finds the one Apply readiness step of the app (lib/apply-readiness.js): apply-handlers.js keeps it here, Ready's night and Prepare top matches read it when they run.
// Invariants: one step per store; a handler group never builds its own kit draft or form read (guard desktop/test/guards/rules/apply-readiness-only-path.test.js).
// Why (8 Nov 2026, owner: "every Apply goes through Apply readiness"): the groups are registered in a fixed order and Ready's night is registered before the step exists, so it looks the step up when it runs, not when it is registered.

const kept = new WeakMap();

/** Keeps the step for a store (apply-handlers.js, once). */
export const keepReadiness = (storage, readiness) => { kept.set(storage, readiness); return readiness; };

const clouds = new WeakMap();
/** The cloud read of the run in flight for a store (lib/cloud-read.js), or null when it ends: the step's readForm takes its reads from it, else reads in Chrome on this Mac. */
export const keepCloudRead = (storage, reader) => { if (reader) clouds.set(storage, reader); else clouds.delete(storage); };
export const cloudReadOf = storage => clouds.get(storage) || null;

/** The step for a store, or null before apply-handlers.js registered it (a test with no apply handlers). */
export const readinessOf = storage => kept.get(storage) || null;
