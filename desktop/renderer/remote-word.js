// The "Remote jobs" setting's word (yes | no | country) as the engine reads it: the ONE place the No words live for the app (renderer/draft-strategy.js cards and lib/strategy-rebuild.js review).
// Why (Gitar on #3779, 11 Nov 2026): the No words were copied in three places; the Python engine reads them in one home, src/my_places.py NO_WORDS (tests/unit/sources/test_places_one_home.py holds both equal).
// Guarded by test/unit/main/strategy-reach.test.js.
const NO_WORDS = new Set(['no', 'non', 'nein', 'none', 'never', 'off', 'false']);
/** True when one saved or drafted value says No in any of the words src/sources/feeds.py remote_wanted reads. */
export const isNoWord = value => NO_WORDS.has(String(value ?? '').trim().toLowerCase());
/** yes | no | country of a saved or drafted "Remote jobs" LIST, as the engine reads it (a value that is not a list says nothing there, so it is `missing`); '' or `missing` when no word is said. */
export const remoteWordOf = (list, missing = '') => {
  const said = (Array.isArray(list) ? list : []).map(value => String(value ?? '').trim().toLowerCase());
  return said.some(isNoWord) ? 'no' : said.includes('country') ? 'country' : said.includes('yes') ? 'yes' : missing;
};
