// Settings: the one Always on card where the person picks a way (owner, 4 Nov 2026). It sits above the GitHub card (connections.js) and the "our servers" card (hosted.js)
// and shows only the picked way's card under it, so Settings reads as one card. Nothing turns off by itself: the card says what is running and where to turn it off.
import {el, pill, choiceCards} from '../components.js';
import {icon} from '../icons.js';
import {$, show} from './core.js';
import {shared} from './shared.js';
import {beforeOpen} from './open-hooks.js';
import {setWay} from './always-on-test.js';
import {openProtect} from './always-on-protect.js';
import {NOTE as PRIVACY, LINK as PRIVACY_LINK} from '../always-on-protect-words.js';
import {NAME, LEAD, choices, oursPickable, pill as statePill, running, startWay, notice} from '../always-on-choice-words.js';

const CARDS = {ours: 'setting-hosted', own: 'setting-cloud'};
let picked = '', lastNow;

const nowRunning = () => running({hostedOn: !!shared.hosted?.on, cloudRepo: shared.state?.settings?.cloud?.repo || ''});
// Our servers can take it: the site is open and this install holds the in-house key (Free AI or Pro). Unknown (not loaded yet) counts as yes, so the card is not wrong for a moment.
const canRun = () => shared.hosted?.canRun !== false || shared.hosted?.available === false;   // available:false is the demo, which pretends
const isOpen = () => shared.hosted?.open !== false && canRun();
// The way that runs now stays pickable whatever open/canRun say (#3158).
const oursReachable = () => oursPickable({open: isOpen(), now: nowRunning()});

/** Show one way: its card under the choice, the other hidden. A way that is not open yet cannot be picked, unless it is what runs now (#3158: it is where Always on is turned off). */
export function pick(way) {
  if (way === 'ours' && !oursReachable()) way = 'own';
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
  // The privacy line shows while "on our servers" is the picked way; its button only while that way is running (owner, 5 Nov 2026: the popup opens "when the user activates this option").
  const privacy = el('div', 'aon-privacy'), line = el('p', 'muted small', PRIVACY), more = el('button', 'secondary with-icon', icon('shield'));
  privacy.id = 'aon-privacy'; more.id = 'aon-protect-open'; more.type = 'button'; more.append(PRIVACY_LINK); more.addEventListener('click', openProtect);
  privacy.append(line, more);
  card.append(head, el('p', 'muted panel-lead', LEAD), group, note, privacy);
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
  if (!picked || (picked === 'ours' && !oursReachable())) picked = startWay({now, open: isOpen()});
  if (now !== lastNow) { if (now && now !== 'both') picked = now; lastNow = now; }   // the view follows what starts running
  $('aon-choice-pill').replaceChildren(pill(...statePill(now), {dot: true}));
  $('aon-choices').replaceChildren(choiceCards(choices({open: shared.hosted?.open !== false, canRun: canRun(), now}), {selected: picked, onPick: pick, label: NAME}));
  $('aon-choice-note').textContent = notice({now, picked});
  show($('aon-choice-note'), !!notice({now, picked}));
  show($('aon-privacy'), picked === 'ours');
  show($('aon-protect-open'), now === 'ours' || now === 'both');   // hostedSearch.on: the way that runs on our servers
  const alt = $('aon-key-alt');
  if (alt) alt.hidden = alt.dataset.need !== '1' || !isOpen();   // "no key? use our servers" only while our servers can take it
  for (const [way, id] of Object.entries(CARDS)) {
    const node = $(id);
    if (!node) continue;
    node.classList.add('aon-way');
    node.hidden = way !== picked;
  }
  placeTest();
}

// The Test row is one node that sits at the end of the picked way's card (owner, 4 Nov 2026: the test button is for "our servers" and for "own accounts"), so it is never twice in the page.
function placeTest() {
  const row = $('aon-test'), card = $(CARDS[picked]);
  if (!row || !card) return;
  if (picked === 'own') { const before = $('tg-cloud'); if (row.nextElementSibling !== before) before.before(row); }
  else if (row.parentElement !== card) card.append(row);
  setWay(picked);
}
