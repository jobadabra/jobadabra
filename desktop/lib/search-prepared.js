// After the search settings are saved, the engine works out what a search must know before it reads anything: where the places are and what kind
// of work the roles are (src/search_prepared.py). The next Find jobs then starts with those answers instead of asking them inside its 3 minutes.
// Why (owner, 10 Nov 2026, asked via AskUserQuestion: "Yes, at strategy save (Recommended)"; sa, 12 Nov 2026: in recorded first searches the employers
// of a person's kind were known 22-113 s in, and 1-2 s in the second search).
// Invariants: never awaited by a save and never fails one (a search asks the same questions itself, as before); one owner of the call, this function.
import {log as appLog} from './log.js';

/** Starts the preparation with the app's engine runner (lib/pipeline.js run). -> a promise of true when the engine finished it; a save does not wait for it. */
export function prepareSearch(storage, run) {
  if (typeof run !== 'function') return Promise.resolve(false);
  return Promise.resolve().then(() => run(storage, ['src.search_prepared']))
    .then(result => { const ok = result?.code === 0; if (!ok) appLog('strategy', 'search not prepared; the next search asks for itself', {code: result?.code ?? null}); return ok; })
    .catch(error => { appLog('strategy', 'search not prepared; the next search asks for itself', {error: error.message}); return false; });
}
