// The slimmer menu: Interviews after the first application, Reports after the first weekly report, a dot once, and every screen still in ⌘K.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PROGRESSIVE, load, looks, nextState, save, stillLocked} from '../../../renderer/menu-reveal.js';
import {STOPS, captureRun, cardSpot, markSeen, nextPresent, seen, stopsFor} from '../../../renderer/menu-tour.js';

const read = name => readScreenSource(new URL(`../../../renderer/${name}`, import.meta.url), 'utf8');
const empty = {revealed: [], opened: []};
const none = {applied: false, weeklyReport: false, employers: false};

test('day 1 shows neither page; the first application shows Interviews, the first weekly report shows Reports', () => {
  assert.deepEqual(looks(nextState(empty, none), 'interviews'), {shown: false, dot: false});
  assert.deepEqual(looks(nextState(empty, none), 'reports'), {shown: false, dot: false});
  const applied = nextState(empty, {...none, applied: true});
  assert.deepEqual(looks(applied, 'interviews'), {shown: true, dot: true});
  assert.equal(looks(applied, 'reports').shown, false);
  assert.deepEqual(looks(nextState(empty, {...none, weeklyReport: true}), 'reports'), {shown: true, dot: true});
});

test('once shown a page stays, and its dot goes when it is opened ', () => {
  let state = nextState(empty, {...none, applied: true});
  state = nextState(state, none);   // the signal went away (a deleted row): the page stays
  assert.equal(looks(state, 'interviews').shown, true);
  state = nextState(state, none, 'calendar');
  assert.deepEqual(looks(state, 'calendar'), {shown: true, dot: false});
  assert.deepEqual(looks(state, 'interviews'), {shown: true, dot: true});   // each page has its own dot
});

test('a page opened from ⌘K before its signal is in the menu from then on, without a dot', () => {
  const state = nextState(empty, none, 'reports');
  assert.deepEqual(looks(state, 'reports'), {shown: true, dot: false});
});

test('the state is kept in the browser storage, and a broken one starts again', () => {
  const store = new Map(), storage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)};
  save(storage, {revealed: ['reports'], opened: []});
  assert.deepEqual(load(storage), {revealed: ['reports'], opened: []});
  store.set('jp.menu.reveal', '{not json');
  assert.deepEqual(load(storage), empty);
  assert.deepEqual(load({getItem: () => { throw new Error('blocked'); }}), empty);
});

// The class: every screen is reachable from ⌘K whether or not its menu button is shown.
test('every screen has a menu button the palette lists, hidden or not', () => {
  const html = read('index.html');
  const views = [...html.matchAll(/<div class="view[^"]*" data-view="([a-z-]+)"/g)].map(match => match[1]);
  const navs = new Set([...html.matchAll(/<button class="nav[^"]*" data-view="([a-z-]+)"/g)].map(match => match[1]));
  assert.ok(views.length >= 10, 'the views are found');
  for (const view of views) assert.ok(navs.has(view), `${view} has a menu button of its own`);
  for (const name of Object.keys(PROGRESSIVE)) assert.match(html, new RegExp(`<button class="nav" data-view="${name}" id="nav-${name}" hidden>`), `${name} starts hidden`);
  const nav = read('pages/nav.js');
  const line = nav.split('\n').find(text => text.includes("add('Go to', `Open ${labelOf(nav)}`"));
  assert.ok(line && /document\.querySelectorAll\('\.nav'\)/.test(line), 'the palette lists every .nav');
  assert.ok(!/\[hidden\]|:not\(/.test(line), 'and does not skip hidden ones');
});

test('Calendar is its own menu button right after Interviews, hidden until it unlocks, with no tab strip on either screen', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /data-iv-tabs/);
  assert.match(html, /id="nav-interviews" hidden>[^\n]*\n\s*<button class="nav" data-view="calendar" id="nav-calendar" hidden><i data-icon="calendar"><\/i>Calendar/);
  assert.match(html, /<i data-icon="check"><\/i>Actions/);
});

test('Employers appears with the first employer', () => {
  assert.equal(looks(nextState(empty, none), 'employers').shown, false);
  assert.deepEqual(looks(nextState(empty, {...none, employers: true}), 'employers'), {shown: true, dot: true});
});

test('More lists the hidden pages with when they unlock, counts them, and is gone at 0', () => {
  const names = state => stillLocked(state).map(page => page.name);
  assert.deepEqual(names(empty), ['interviews', 'calendar', 'reports', 'employers']);
  assert.ok(stillLocked(empty).every(page => page.when && page.label && page.icon));
  assert.deepEqual(stillLocked(empty).map(page => page.when), ['after your first application', 'with interviews', 'after your first week', 'after your first employer search']);
  const applied = nextState(empty, {...none, applied: true});
  assert.deepEqual(names(applied), ['reports', 'employers']);   // Calendar unlocks with Interviews
  assert.equal(stillLocked(nextState(applied, {applied: true, weeklyReport: true, employers: true})).length, 0);
  assert.deepEqual(names(nextState(empty, none, 'calendar')), ['interviews', 'reports', 'employers']);   // opened from More: it joins the menu by itself
});

test('every progressive page has a More entry, and More is in the markup closed, with its state remembered', () => {
  for (const name of Object.keys(PROGRESSIVE)) assert.ok(stillLocked(empty).some(page => page.name === name), name);
  const html = read('index.html');
  assert.match(html, /id="nav-more" hidden>/);
  assert.match(html, /id="nav-more-head" aria-expanded="false"/);
  assert.match(read('pages/menu.js'), /jp\.menu\.more/);
  assert.match(html, /<button class="nav" data-view="employers" id="nav-employers" hidden>/);
});

test('the palette does not list the More rows as pages (they are not .nav buttons)', () => {
  assert.doesNotMatch(read('pages/menu.js'), /className: 'nav[ '"]/);
});

test('the tour: eleven stops in order, only those on screen, shown once', () => {
  assert.deepEqual(STOPS.map(stop => stop.id), ['focus', 'jobs', 'applying', 'actions', 'more', 'feedback', 'theme', 'collapse', 'palette', 'sessions', 'activity']);
  assert.deepEqual(stopsFor(selector => !selector.includes('more')).map(stop => stop.id), ['focus', 'jobs', 'applying', 'actions', 'feedback', 'theme', 'collapse', 'palette', 'sessions', 'activity']);
  const store = new Map(), storage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)};
  assert.equal(seen(storage), false);
  markSeen(storage);
  assert.equal(seen(storage), true);
  assert.equal(seen({getItem: () => { throw new Error('blocked'); }}), true);   // blocked storage: never nag
  for (const stop of STOPS) assert.ok(read('index.html').includes(stop.target.startsWith('#') ? `id="${stop.target.slice(1)}"` : `data-view="${stop.target.match(/data-view="([a-z]+)"/)[1]}"`), stop.id);
});

test('the tour never shows in a screenshot run (owner, 17 Oct 2026: it covered the sidebar in PR shots)', () => {
  assert.equal(captureRun('?capture=1'), true);
  assert.equal(captureRun(''), false);
  assert.equal(captureRun(undefined), false);
  assert.match(read('pages/menu.js'), /if \(seen\(window\.localStorage\) \|\| captureRun\(window\.location\.search\)/);
});

// Why (fb 6/7, 5 Nov 2026): the Send feedback stop is at the foot of the sidebar, and the two bars at the foot of the window run its whole width; a card level with them ran past the window's edge.
test('the tour card stays inside the window: beside a menu button, or above a wide bar, never off an edge', () => {
  const window900 = {width: 1400, height: 900}, card = {cardWidth: 250, cardHeight: 120, viewport: window900, sidebarRight: 214};
  assert.deepEqual(cardSpot({...card, rect: {top: 300, height: 40}}), {top: 280, left: 226}, 'a stop in the middle: level with it, beside the menu');
  assert.equal(cardSpot({...card, rect: {top: 2, height: 20}}).top, 8, 'a stop at the very top');
  assert.equal(cardSpot({...card, rect: {top: 850, height: 36}}).top, 772, 'a menu button at the foot: lifted so the whole card shows (900 - 120 - 8)');
  assert.deepEqual(cardSpot({...card, rect: {top: 850, height: 50}, above: true}), {top: 718, left: 226}, 'a bar at the foot: the card sits above it');
  assert.equal(cardSpot({...card, rect: {top: 100, height: 36}, cardHeight: 2000}).top, 8, 'a window shorter than the card: top edge wins');
  assert.equal(cardSpot({...card, rect: {top: 300, height: 40}, viewport: {width: 300, height: 900}}).left, 42, 'a narrow window: the card is pulled in from the right edge (300 - 250 - 8)');
});

// Why (code review of fb 6b/7, 5 Nov 2026): a person who opens the Sessions page mid-tour hides the tray; the card must skip that stop, not point at nothing.
test('the tour moves on past a stop whose target is no longer on screen', () => {
  const stops = [{target: '#a'}, {target: '#b'}, {target: '#c'}];
  assert.equal(nextPresent(stops, 0, () => true), 0);
  assert.equal(nextPresent(stops, 1, target => target !== '#b'), 2, 'the hidden stop is skipped');
  assert.equal(nextPresent(stops, 1, target => target === '#a'), 3, 'nothing left: the tour ends');
});
