// Settings: the one Always on card where the person picks a way (owner, 4 Nov 2026). It sits above the GitHub card (connections.js) and the "our servers" card (hosted.js)
// and shows only the picked way's card under it, so Settings reads as one card. Nothing turns off by itself: the card says what is running and where to turn it off.
import {el, pill, choiceCards} from '../components.js';
import {icon} from '../icons.js';
import {$, show} from './core.js';
import {shared} from './shared.js';
import {beforeOpen} from './open-hooks.js';
import {NAME, LEAD, choices, pill as statePill, running, startWay, notice} from '../always-on-choice-words.js';

const CARDS = {ours: 'setting-hosted', own: 'setting-cloud'};
let picked = '', lastNow;

const nowRunning = () => running({hostedOn: !!shared.hosted?.on, cloudRepo: shared.state?.settings?.cloud?.repo || ''});
// Our servers can take it: the site is open and this install holds the in-house key (Free AI or Pro). Unknown (not loaded yet) counts as yes, so the card is not wrong for a moment.
const canRun = () => shared.hosted?.canRun !== false || shared.hosted?.available === false;   // available:false is the demo, which pretends
const isOpen = () => shared.hosted?.open !== false && canRun();

/** Show one way: its card under the choice, the other hidden. A way that is not open yet cannot be picked. */
export function pick(way) {
  if (way === 'ours' && !isOpen()) way = 'own';
  picked = way;
  draw();
}

/** Mount the card once, above the GitHub card. */
export function mountChoice() {
  if ($('setting-always-on') || !$('setting-cloud')) return;
  const card = el('div', 'setting panel aon-chooser'); card.id = 'setting-always-on';
  const head = el('div', 'summary-head'), state = el('span'); state.id = 'aon-choice-pill';
  head.append(icon('refresh'), el('h3', '', NAME), state);
  const group = el('div'); group.id = 'aon-choices';
  const note = el('p', 'muted small'); note.id = 'aon-choice-note';
  card.append(head, el('p', 'muted panel-lead', LEAD), group, note);
  $('setting-cloud').before(card);
  beforeOpen.cloud = () => pick('own');
  beforeOpen.hosted = () => pick('ours');
  beforeOpen['tg-cloud'] = () => pick('own');   // the Telegram buttons row lives inside the GitHub way's card
  draw();
}

/** Draw the card from the current state (called after the GitHub or hosted state changes). */
export function draw() {
  if (!$('setting-always-on')) return;
  const now = nowRunning();
  if (!picked || (picked === 'ours' && !isOpen())) picked = startWay({now, open: isOpen()});
  if (now !== lastNow) { if (now && now !== 'both') picked = now; lastNow = now; }   // the view follows what starts running
  $('aon-choice-pill').replaceChildren(pill(...statePill(now), {dot: true}));
  $('aon-choices').replaceChildren(choiceCards(choices({open: shared.hosted?.open !== false, canRun: canRun()}), {selected: picked, onPick: pick, label: NAME}));
  $('aon-choice-note').textContent = notice({now, picked});
  show($('aon-choice-note'), !!notice({now, picked}));
  const alt = $('aon-key-alt');
  if (alt) alt.hidden = alt.dataset.need !== '1' || !isOpen();   // "no key? use our servers" only while our servers can take it
  for (const [way, id] of Object.entries(CARDS)) {
    const node = $(id);
    if (!node) continue;
    node.classList.add('aon-way');
    node.hidden = way !== picked;
  }
}
