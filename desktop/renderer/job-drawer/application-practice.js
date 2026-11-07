// Application → Practice (practice run only, spec 2026-11-07-practice-jobs-design.md PR 3/4): what the catcher received when Full automation pressed Submit on this job: when, how, and each field with the value
// that was sent. Read from the catcher's ledger by the main process (IPC practiceCaught); a password shows "[hidden]". Same parts as Submitted (state card, fact grid, group).
import {el} from '../components.js';
import {PRACTICE_WORDS as W, caughtFacts} from '../practice-words.js';
import {factGrid, group, skeleton, stateCard} from './parts.js';

const cache = new Map();   // job url → entries | 'loading'

/** The Practice view for the drawer: a waiting card, or one block per caught submission (newest first). `redraw` runs when the ledger answers. */
export function practiceView({job}, redraw) {
  const have = cache.get(job.url);
  if (have === undefined) {
    cache.set(job.url, 'loading');
    const settle = entries => { cache.set(job.url, Array.isArray(entries) ? entries : []); redraw(); };   // a failed read redraws too: the skeleton must not stay up
    window.pilot.practiceCaught(job.url).then(settle, () => settle([]));
  }
  if (have === undefined || have === 'loading') return skeleton();   // not "nothing caught" while the ledger is still being read
  const entries = Array.isArray(have) ? have : [];
  if (!entries.length) return [stateCard({icon: 'info', title: W.waitingTitle, text: W.waitingText})];
  return [stateCard({icon: 'check-circle', tone: 'good', title: W.caughtTitle(entries.length), text: W.caughtText}), ...entries.flatMap(entry => [
    factGrid(caughtFacts(entry, new Date(entry.at).toLocaleString())),
    group(W.fields, entry.fields.map(([name, value]) => { const row = el('div', 'iv-moment'); row.append(el('b', '', name), el('div', '', value === '' ? W.empty : value)); return row; })),
  ])];
}

/** Forgets what was read for a job (the drawer asks again the next time it opens, so a new Submit shows). */
export const forgetPractice = url => cache.delete(url);
