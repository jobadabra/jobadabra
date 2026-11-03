// The one setSecret every in-memory fake storage of the desktop tests uses: it refuses a name lib/storage.js SECRET_NAMES does not hold, as the real store does ("Unknown secret <name>").
// Why (3 Nov 2026, owner via the coordinator): 25 fakes accepted any name, so a repo key that could never be stored on a real install passed every test for weeks (#3122).
// A test that needs a secret the app really keeps adds its name to SECRET_NAMES; one that used an invented name now fails here.
import {SECRET_NAMES} from '../lib/storage.js';

/** -> a setSecret(name, value) that throws on a name outside SECRET_NAMES, else calls apply(name, value) (default: keep nothing). */
export const strictSetSecret = (apply = () => {}) => (name, value) => {
  if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret ${name}`);
  return apply(name, value);
};
