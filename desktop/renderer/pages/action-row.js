// The session card's action row (#ss-actions) is drawn in place: a button that is the same after a redraw stays the same node.
// Why (7 Nov 2026, owner's red-main alert, E2E run 42337402105): renderLive and renderNextStep replaced every button on each redraw (a page-facts event, a refresh of the open session),
// also when the actions had not changed. A press whose mousedown and mouseup straddle a redraw hits two nodes and does nothing, and a test (or a person) never gets a stable Stop.
import {el} from '../components.js';
import {icon} from '../icons.js';

/**
 * One action button. Its handler is read from `run` at click time, so drawActions can keep this node and point it at the newest closure (the redraw's item and callbacks).
 * kind: the button class ('primary' | 'secondary' | 'link'); glyph: an icon name or ''.
 */
export function actionButton(text, kind, run, glyph = '') {
  const node = el('button', `${kind}${glyph ? ' with-icon' : ''}`);
  if (glyph) node.append(icon(glyph));
  node.append(el('span', '', text));
  node.run = run;
  node.addEventListener('click', event => node.run(event));
  return node;
}

/**
 * Draw `nodes` as the children of `root`. When the row already shows the same actions (same markup, in order) the existing buttons stay and only take the new handlers;
 * the row is replaced when the action set changes. Invariant: a button is kept only if every new button came from actionButton (it has a `run` to hand over).
 */
export function drawActions(root, nodes) {
  const old = [...root.children];
  const same = old.length === nodes.length && nodes.every((node, i) => old[i].outerHTML === node.outerHTML && (node.tagName !== 'BUTTON' || (typeof node.run === 'function' && typeof old[i].run === 'function')));
  if (!same) { root.replaceChildren(...nodes); return; }
  nodes.forEach((node, i) => { if (node.run) old[i].run = node.run; });
}
