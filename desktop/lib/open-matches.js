// How many open jobs the person has in their places right now, from the engine's read-only count (src/search_report.py --open-count); null when it cannot be read. Feeds the thin-search ask (lib/asks.js).
import {run} from './pipeline-run.js';

/** -> an integer >= 0, or null. `exec` is lib/pipeline-run.js run, replaceable in tests. */
export async function openInPlaces(storage, exec = run) {
  try {
    const {stdout, code} = await exec(storage, ['src', 'search_report', '--open-count'], () => {}, {}, {privateOutput: true});
    if (code !== 0) return null;
    const count = JSON.parse(String(stdout).trim().split('\n').pop())?.open_in_places;
    return Number.isInteger(count) && count >= 0 ? count : null;
  } catch { return null; }
}
