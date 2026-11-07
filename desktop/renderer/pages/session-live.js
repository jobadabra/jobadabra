// The Applying card of a hidden-browser session becomes its live page (spec 2026-10-27-background-apply-execution, step B; owner's live view design,
// 28 Oct 2026, mockup https://claude.ai/artifact/Lq3MeVUtavGRm8W2sZekPS): a Live strip (address, zoom, Expand), the page's picture with the required
// fields still empty framed, a note line, then the actions. Four states: Filling, A bot check needs you, Review, Ready to submit. Pictures, the page's
// facts and the dropdown/file asks come from main's 'liveEvent' (lib/live-view-handlers.js); the person's mouse and keys go back as liveInput.
// Guard: test/unit/renderer/session-live.test.js.
import {t} from '../../i18n/index.js';
import {el, liveDot, pill} from '../components.js';
import {icon} from '../icons.js';
import {$} from './core.js';
import {shared} from './shared.js';
import {keyMessage, liveCard, toPage} from '../live-card.js';
import {onLeaveView} from './view-leave.js';
import {START, step, streaming} from '../live-view-state.js';
import {createLagMeter, createPictureSink, stageState} from '../live-frames.js';
import {plainError} from '../run-warnings.js';

const ZOOMS = [50, 75, 100, 125, 150];

let view = null;   // the one open live view: {id, root, img, marks, ask, w, h, facts, zoom, card, item, on}
let listening = false;
let clock = 0;   // the once-a-second redraw of the title while a card counts down; one at most

// The session's live view, built once per session and kept across redraws (its picture never reloads while the card redraws).
function viewFor(item) {
  if (view?.id === item.id) return view;
  closeLive();
  const img = Object.assign(el('img', 'live-img'), {alt: 'The application page, live', draggable: false});
  const marks = el('div', 'live-marks'), page = el('div', 'live-page'), screen = el('div', 'live-screen'), strip = el('div', 'live-strip');
  const empty = el('div', 'live-empty');
  const ask = el('div', 'live-ask'), filling = el('div', 'live-filling'), zoomText = el('span', 'live-zoom-text', '100%'), address = el('span', 'live-url', '');
  ask.hidden = true; filling.hidden = true;
  page.append(img, marks);
  screen.append(empty, page);
  screen.tabIndex = 0;
  const stage = el('div', 'live-stage');   // the strip and an ask stay put while the picture scrolls
  stage.append(screen, filling, ask);
  const zoomButton = (text, label, step) => Object.assign(el('button', 'secondary live-zoom', text), {ariaLabel: label, onclick: () => setZoom(step)});
  const expand = el('button', 'secondary live-zoom with-icon', icon('maximize'));
  expand.ariaLabel = 'Expand';
  expand.onclick = () => { root.classList.toggle('is-expanded'); expand.replaceChildren(icon(root.classList.contains('is-expanded') ? 'collapse' : 'maximize')); };
  const hide = Object.assign(el('button', 'secondary live-zoom', t('pagesCommon.hide')), {ariaLabel: 'Hide the live page', onclick: () => dispatch(mine, {type: 'hide'})});
  strip.append(liveDot('live'), el('b', '', 'Live'), address, el('span', 'live-gap'), zoomButton('−', 'Zoom out', -1), zoomText, zoomButton('+', 'Zoom in', 1), expand, hide);
  const root = el('div', 'live-view');
  root.append(strip, stage);
  // state: what the view is doing (renderer/live-view-state.js, its one owner); checked: the card kind whose page was last asked about (livePage); drawn: the stage last drawn.
  view = {id: item.id, root, img, marks, ask, filling, address, zoomText, screen, page, empty, expand, w: 0, h: 0, facts: null, zoom: 100, item, state: START, checked: '', drawn: ''};
  const mine = view;
  const lag = createLagMeter();
  let reported = Date.now();
  // Pictures reach the image only through the sink: the newest, once per display refresh (renderer/live-frames.js).
  mine.pictures = createPictureSink(img, requestAnimationFrame, message => {
    if (view !== mine || !streaming(mine.state)) return;   // a picture still in flight after Hide is not shown
    if (message.w && message.h) { mine.w = message.w; mine.h = message.h; }
    if (mine.state.kind === 'opening') dispatch(mine, {type: 'picture'});   // the first painted picture ends the placeholder
    lag.record(message.at);
    if (Date.now() - reported > 10000) { reported = Date.now(); window.pilot.uiLog('live view: picture age at paint (ms) and pictures a second', lag.take()).catch(() => {}); }   // the app log has the numbers when it feels slow
  });
  wireInput(view);
  drawStage(view);
  return view;
}
// The stage for the view's state (stageState): the picture, or a note saying what is going on; never a broken image. Drawn again only when it changes, so a press is not lost to a redraw.
function drawStage(v) {
  const state = stageState({kind: v.state.kind, note: v.state.note, input: !!v.card?.input});
  v.address.textContent = plainError(v.facts?.address || '');
  const key = JSON.stringify(state);
  if (key === v.drawn) return;
  v.drawn = key;
  v.root.classList.toggle('is-empty', state.kind !== 'picture');
  v.root.dataset.stage = state.kind;
  if (state.kind === 'picture') { v.empty.replaceChildren(); return; }
  const lead = state.kind === 'waiting' ? el('span', 'spinner') : icon(state.kind === 'off' ? 'eye' : 'alert');
  const words = el('div', 'live-empty-words');
  words.append(el('b', 'live-empty-title', state.title), el('p', 'muted small', state.text));
  const parts = [lead, words];
  if (state.action) parts.push(button(state.action, 'secondary', () => dispatch(v, {type: 'watch'}), 'eye'));
  v.empty.replaceChildren(...parts);
}
// Every change of the view's state goes through here (renderer/live-view-state.js step); its effect is main's open (liveOpen, tagged with the ask's number) or close.
// The view of another session was already closed when this one was built (viewFor), so one streams at a time.
function dispatch(v, event) {
  const {state, effect} = step(v.state, event);
  v.state = state;
  if (effect === 'open') {
    const ask = state.ask;
    Promise.resolve().then(() => window.pilot.liveOpen(v.id)).then(result => result || {ok: false}, error => ({ok: false, error: plainError(String(error?.message || error))}))
      .then(result => { if (view === v) dispatch(v, {type: 'answer', ask, ok: !!result.ok, closed: !!result.closed, error: result.error || '', filling: v.card?.kind === 'filling'}); });
  }
  if (effect === 'close') { window.pilot.liveClose(v.id); v.pictures.clear(); }
  if (!streaming(state) && v.root.classList.contains('is-expanded')) { v.root.classList.remove('is-expanded'); v.expand.replaceChildren(icon('maximize')); }   // Expand's Collapse lives in the Live strip, hidden now
  v.root.classList.toggle('is-watching', streaming(state));
  drawStage(v);
}
// Whether the hidden page exists, asked once per card kind (review, ready, a check…), never per redraw (lib/live-view-handlers.js livePage). A filling job is not asked:
// its page may open a moment after the card is drawn, and a new fill may bring back a page that was closed.
function checkPage(v, kind) {
  if (v.checked === kind) return;
  v.checked = kind;
  if (kind === 'filling') { dispatch(v, {type: 'filling'}); return; }
  window.pilot.livePage(v.id).then(result => { if (view === v) dispatch(v, {type: 'page', open: result ? result.open : null, error: result?.error || '', filling: v.card?.kind === 'filling'}); },
    error => window.pilot.uiLog('live view: the page check failed', {error: String(error?.message || error)}).catch(() => {}));   // Watch live is still offered; its own answer says why
}
function setZoom(step) {
  if (!view) return;
  view.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(view.zoom) + step))];
  view.page.style.width = `${view.zoom}%`;
  view.zoomText.textContent = `${view.zoom}%`;
}
// The person's mouse, wheel and keys on the picture go to the page as theirs; while the fill runs they wait (the card says so).
function wireInput(v) {
  const send = message => { if (v.card?.input) window.pilot.liveInput(v.id, message); };
  const mouse = type => event => {
    if (!v.w || !v.h) return;
    const at = toPage(event.clientX, event.clientY, v.img.getBoundingClientRect(), v.w, v.h);
    send({t: 'mouse', type, ...at, button: type === 'mouseMoved' ? 'none' : 'left', buttons: event.buttons, clickCount: type === 'mouseMoved' ? 0 : 1});
  };
  let moved = 0;
  v.img.addEventListener('mousedown', event => { v.screen.focus(); mouse('mousePressed')(event); });
  v.img.addEventListener('mouseup', mouse('mouseReleased'));
  v.img.addEventListener('mousemove', event => { if (Date.now() - moved > 50) { moved = Date.now(); mouse('mouseMoved')(event); } });
  v.img.addEventListener('wheel', event => {
    if (!v.card?.input || !v.w) return;
    event.preventDefault();
    const at = toPage(event.clientX, event.clientY, v.img.getBoundingClientRect(), v.w, v.h);
    send({t: 'mouse', type: 'mouseWheel', ...at, deltaX: event.deltaX, deltaY: event.deltaY});
  }, {passive: false});
  v.screen.addEventListener('keydown', event => { if (v.card?.input && !event.metaKey) { event.preventDefault(); send(keyMessage(event)); } });
  v.screen.addEventListener('keyup', event => { if (v.card?.input && !event.metaKey) { event.preventDefault(); send(keyMessage(event, true)); } });
}
// The page asked for a choice the hidden browser cannot draw: a dropdown's list, or a file. The person answers here; nothing is picked for them.
function showAsk(v, message) {
  const done = () => { v.ask.hidden = true; v.ask.replaceChildren(); };
  if (message.kind === 'select') {
    const list = Object.assign(el('select', 'live-ask-list'), {size: Math.min(8, Math.max(2, message.options.length)), ariaLabel: message.label || 'Choose one'});
    list.append(...message.options.map(option => Object.assign(el('option', '', option.label || option.value), {value: option.value, disabled: option.disabled, selected: option.value === message.value})));
    list.onchange = () => { window.pilot.liveInput(v.id, {t: 'choose', id: message.id, value: list.value}); done(); };
    v.ask.replaceChildren(el('b', '', message.label || 'Choose one'), list, Object.assign(el('button', 'secondary', t('pagesCommon.cancel')), {onclick: done}));
  } else {
    const answer = choice => () => { window.pilot.liveInput(v.id, {t: 'file', id: message.id, choice}); done(); };
    v.ask.replaceChildren(el('b', '', 'The page asks for a file'), Object.assign(el('button', 'primary', 'Your CV'), {onclick: answer('cv')}),
      Object.assign(el('button', 'secondary', 'Choose a file…'), {onclick: answer('pick')}), Object.assign(el('button', 'secondary', t('pagesCommon.cancel')), {onclick: answer('')}));
  }
  v.ask.hidden = false;
}
// One event from main for the open view: a picture, the page's facts, or an ask.
export function liveEvent({session, message} = {}) {
  if (!view || session !== view.id || !message) return;
  if ((message.kind === 'first' || message.kind === 'frame') && !streaming(view.state)) return;
  if (message.kind === 'first') view.pictures.first(message);
  else if (message.kind === 'frame') view.pictures.frame(message);
  else if (message.kind === 'needs') {
    view.facts = message;
    renderLive(view.item, view.on);   // Submit turns on, a count changes: the actions follow the page
  } else if (message.kind === 'closed') {
    view.checked = '';   // the next draw asks main whether the page is still there
    dispatch(view, {type: 'dropped'});
    renderLive(view.item, view.on);
  } else if (message.kind === 'select' || message.kind === 'file') showAsk(view, message);
}
/** Close the open live view (another session shown, or none): the stream stops in main. */
export function closeLive() {
  clearInterval(clock);
  if (!view) return;
  window.pilot.liveClose(view.id);
  view.pictures.clear();
  view = null;
}
onLeaveView('sessions', closeLive);   // Why (2026-10-28, B follow-up 1): going to another page closes the stream too, not only drawing another session
const button = (text, kind, run, glyph) => {
  const node = el('button', `${kind}${glyph ? ' with-icon' : ''}`);
  if (glyph) node.append(icon(glyph));
  node.append(el('span', '', text));
  node.addEventListener('click', run);
  return node;
};
// The header, picture marks, note and actions for the current state; `actions` are the session's own (Open in my browser, Skip, Stop).
function drawCard(item) {
  const v = viewFor(item), card = liveCard(item.background || {}, v.facts, {note: item.note || '', linkOff: shared.formsOpen?.linkOff});
  v.card = card; v.item = item;
  $('ss-decision').className = `ss-next tone-${card.tone}`;
  $('ss-next-title').textContent = card.title;
  $('ss-next-state').textContent = card.meta;
  $('ss-stage').replaceChildren(pill(card.pill[0], card.pill[1], {dot: true}));
  $('ss-form-state').replaceChildren();
  v.root.dataset.frame = card.frame;
  v.root.classList.toggle('is-filling', card.kind === 'filling');
  if (card.live) checkPage(v, card.kind);   // a queued job has no page yet: nothing to ask main for
  drawStage(v);
  v.filling.hidden = !card.filling;
  v.filling.replaceChildren(el('span', 'spinner'), el('span', '', `Filling "${card.filling}"…`));
  v.marks.replaceChildren(...(card.marks ? (v.facts?.left || []) : []).map(box => Object.assign(el('span', 'live-mark'), {title: box.label,
    style: `left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%`})));
  $('ss-question').replaceChildren(...(card.live ? [v.root] : []), el('p', 'rich-p muted small', card.note));
  clearInterval(clock);
  if (card.kind === 'countdown') clock = setInterval(() => { if (view?.id === item.id && view.card?.kind === 'countdown') $('ss-next-title').textContent = liveCard(item.background, v.facts).title; }, 1000);
  return card;
}
/**
 * Draw a hidden-browser session's card (renderNextStep hands background sessions here). on: {open, skip, problem(title, text)} the session's own actions.
 * Submit presses the page's own sending button through main (liveSubmit), which reads the page again first.
 */
export function renderLive(item, on) {
  if (!listening) { listening = true; window.pilot.onLiveEvent(liveEvent); }
  const card = drawCard(item), actions = [];
  view.on = on;
  if (card.kind === 'waiting') {
    actions.push(button(t('pagesCommon.stop'), 'secondary', async event => { event.currentTarget.disabled = true; await window.pilot.liveStop(item.id); }));
    $('ss-actions').replaceChildren(...actions);
    return;
  }
  if (card.kind === 'filling' || card.stop) {
    actions.push(button(t('pagesCommon.stop'), 'secondary', async event => { event.currentTarget.disabled = true; await window.pilot.liveStop(item.id); }));
  } else {
    const submit = button('Submit application', card.submit.on ? 'primary' : 'secondary', async event => {
      const pressed = event.currentTarget;
      pressed.disabled = true;
      const result = await window.pilot.liveSubmit(item.id).catch(error => ({ok: false, error: error.message}));
      pressed.disabled = false;
      if (!result?.ok) on.problem('Not submitted', result?.error || 'Try again.');
    });
    submit.disabled = !card.submit.on;
    actions.push(submit);
    if (card.submit.hint) actions.push(el('span', 'muted small live-hint', card.submit.hint));
  }
  actions.push(button('Open in my browser', 'secondary', on.open, 'external'));
  if (card.kind !== 'filling' && !card.stop) actions.push(button(t('pagesCommon.skipRole'), 'secondary', on.skip));
  $('ss-actions').replaceChildren(...actions);
}
