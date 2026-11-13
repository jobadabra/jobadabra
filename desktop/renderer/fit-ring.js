// The score ring: a circle filled to the fit, the number inside (style.css .fit-ring). Drawn by the Jobs list rows and the job drawer's
// header, so both read the same. `size` adds a modifier class ('lg' in the drawer).
import {el} from './components.js';
import {icon} from './icons.js';

/** True for a score made with older settings (the engine's `stale` mark) that still has a number: the one rule every ring draws an old score by. */
export const isOldScore = job => !!job.stale && job.fit != null;

/**
 * The score ring: a circle filled to `fit`, the number inside; `size` adds a modifier ('lg' in the drawer). `old` (isOldScore): a dashed grey ring with a refresh badge.
 * Why (13 Nov 2026, owner: "Realistic ring, never hidden"): an old score keeps its number; its look says old and the tooltip says re-score, so no word sits under it. */
export function fitRing(fit, size = '', old = false) {
  const ring = el('div', ['fit-ring', size, old ? 'is-old' : ''].filter(Boolean).join(' '));
  ring.style.setProperty('--p', fit ?? 0);
  ring.append(el('span', '', fit ?? '–'));
  if (old && fit != null) {
    const badge = el('i', 'fit-old-badge');
    badge.append(icon('refresh'));
    ring.append(badge);
  }
  return ring;
}
