// The score ring: a circle filled to the fit, the number inside (style.css .fit-ring). Drawn by the Jobs list rows and the job drawer's
// header, so both read the same. `size` adds a modifier class ('lg' in the drawer).
import {el} from './components.js';
import {icon} from './icons.js';

/**
 * The score ring: a circle filled to `fit` with the number inside. `size` adds a modifier ('lg' in the drawer). `old`: the score was made with older
 * settings, so it is drawn as a dashed grey ring with a refresh badge and its number muted; it keeps its number, nothing replaces it.
 * Why (13 Nov 2026, owner: "Realistic ring, never hidden"; the old-score look replaces the "Old score" word under the ring): the ring says it by its look, the tooltip says re-score.
 */
export function fitRing(fit, size = '', old = false) {
  const ring = el('div', ['fit-ring', size, old ? 'is-old' : ''].filter(Boolean).join(' '));
  ring.style.setProperty('--p', fit ?? 0);
  ring.append(el('span', '', fit ?? '–'));
  if (old && fit != null) {   // an old score: a dashed ring with a refresh badge, never a label under it
    const badge = el('i', 'fit-old-badge');
    badge.append(icon('refresh'));
    ring.append(badge);
  }
  return ring;
}
