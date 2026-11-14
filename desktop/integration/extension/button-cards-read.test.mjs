/* global document, location, history */
// Integration test (#3710 PR 2): a results page whose job cards are pressable blocks with no link, read by the extension's own page functions in a real Chromium.
// The page is the ONE structural copy of a real results page (fixtures/visits/button-cards.html: tags and attribute names only, links as a/# shapes; owner, 12 Nov 2026,
// asked via AskUserQuestion: "Yes, sa's shape + flags"). The copy holds no word and no value, so this test gives it stand-ins before reading, and says which:
// every empty text leaf gets "Stand-in line N"; a link gets its shape back with 12345 for '#', and a link flagged jp-same-path the page's own address; a block with
// role and tabindex gets role=button, tabindex=0; the pager's buttons get their numbers and aria-current true/false; the top link marked aria-current gets "page".
// Stand-ins are chosen to match no word list of the extension, so what is read comes from the structure, not from words. No outside site, no AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {call, callWith, fixtures, launchChromium, serveFixtures} from '../../e2e/lib/visit-page.mjs';
import {checkCopy} from '../../../tools/structure-copy.mjs';

const CARDS = 25, SELECTED = 900001;   // the copy's list: 25 job cards and 4 other blocks (2 with links, 2 with nothing to press)
let server, browser, base;
before(async () => {
  ({server, base} = await serveFixtures());
  browser = await launchChromium();
});
after(async () => {
  await browser?.close();
  await new Promise(done => (server ? server.close(done) : done()));
});

/** The stand-ins (see the header). ids: 'attribute' puts card k's id (900000 + k) in its pressable block's own attribute; 'press' makes pressing card k
 * put that id in the page's address instead, as a page that shows the selected job does. -> the cards' first lines, in order. */
function hydrate({ids, selected}) {
  let line = 0;
  const pager = [...document.querySelectorAll('ul')].find(list => list.children.length >= 2 && [...list.children].every(item => item.querySelector('button[aria-current]')));
  pager.querySelectorAll('button').forEach((button, index) => {
    button.setAttribute('aria-current', index === 0 ? 'true' : 'false');
    button.querySelector('span').textContent = String(index + 1);
    button.addEventListener('click', () => { document.body.dataset.pressed = `page ${index + 1}`; });
  });
  document.querySelector('a[aria-current]').setAttribute('aria-current', 'page');
  for (const node of document.querySelectorAll('[aria-disabled]')) node.setAttribute('aria-disabled', 'false');
  for (const link of document.querySelectorAll('a[href]')) {
    const shape = link.getAttribute('href').replace(/#/g, '12345');
    link.setAttribute('href', link.hasAttribute('jp-same-path') ? `${location.pathname}?jobId=${selected}` : shape);
    link.addEventListener('click', event => { event.preventDefault(); document.body.dataset.pressed = 'a link'; });
  }
  for (const node of document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, a')) if (!node.children.length && !node.textContent.trim()) node.textContent = `Stand-in line ${++line}`;
  const blocks = [...document.querySelectorAll('[role][tabindex]')];
  blocks.forEach(node => { node.setAttribute('role', 'button'); node.setAttribute('tabindex', '0'); });
  const isCard = kid => kid.querySelector('[role][tabindex]') && !kid.querySelector('a[href]');
  const list = [...document.querySelectorAll('div')].find(node => [...node.children].filter(isCard).length >= 20);
  const cards = [...list.children].filter(isCard);
  cards.forEach((card, index) => {
    const block = card.querySelector('[role][tabindex]'), id = 900001 + index;
    if (ids === 'attribute') block.setAttribute('componentkey', `job-card-${id}`);
    else block.addEventListener('click', () => history.replaceState(null, '', `${location.pathname}?jobId=${id}`));
  });
  return cards.map(card => card.innerText.split('\n').map(text => text.trim()).find(Boolean));
}

async function open(ids) {
  const page = await browser.newPage();
  await page.goto(`${base}/button-cards.html?jobId=${SELECTED}`);
  const titles = await page.evaluate(`(${hydrate})(${JSON.stringify({ids, selected: SELECTED})})`);
  return {page, titles};
}

test('the copy in the repo is still bare structure: no text, no value, no digit (Guard: privacy — a real page\'s words would be in the repo)', () => {
  const verdict = checkCopy(fs.readFileSync(path.join(fixtures, 'button-cards.html'), 'utf8').replace(/\n$/, ''));
  assert.ok(verdict.ok, verdict.why);
});

test('cards that are pressable blocks with no link are all read, each with the address its own id gives; the links back to the page are not postings', async () => {
  const {page, titles} = await open('attribute');
  try {
    assert.equal(titles.length, CARDS, 'positive control: the copy holds the list of cards');
    const linked = await call(page, 'extractPage');
    assert.equal(linked.cards.length, 0, 'no link on the page is a posting: the header links point to the page itself');
    const seen = await call(page, 'linklessCards');
    assert.deepEqual(seen.cards.map(card => card.title), titles, `read ${seen.cards.length} cards: ${JSON.stringify(seen.cards.map(card => card.title).slice(0, 4))}`);
    assert.deepEqual(seen.cards.map(card => new URL(card.url).search), titles.map((_, index) => `?jobId=${900001 + index}`));
    assert.ok(seen.cards.every(card => card.lines.length >= 2), 'each card keeps its lines (title and the lines under it)');
  } finally { await page.close(); }
});

test('when the cards hold no id, pressing each one, as a person does, gives the address the page then shows', async () => {
  const {page, titles} = await open('press');
  try {
    const seen = await call(page, 'linklessCards');
    assert.equal(seen.cards.length, 0, 'no card has an address before it is pressed');
    assert.equal(seen.pressCards.length, CARDS, 'every card is offered to be pressed');
    const pressed = await callWith(page, 'addressByPress', {keys: seen.pressCards.map(card => card.key), budgetMs: 20000, gapMs: 0});
    assert.equal(pressed.left, false);
    assert.deepEqual(seen.pressCards.map(card => new URL(pressed.addresses[card.key] || 'https://none.example/').search), titles.map((_, index) => `?jobId=${900001 + index}`));
  } finally { await page.close(); }
});

test('a link on the page\'s own path naming another id is still a posting; only the one naming the job the page shows is dropped (Gitar on #3866)', async () => {
  const {page} = await open('attribute');
  try {
    await page.evaluate(`document.body.insertAdjacentHTML('beforeend', '<ul><li><a href="${'?jobId=900077'}">Stand-in other posting</a></li></ul>')`);
    const linked = await call(page, 'extractPage');
    assert.deepEqual(linked.cards.map(card => new URL(card.url).search), ['?jobId=900077']);
  } finally { await page.close(); }
});

test('links on the page\'s own path with letters in their ids are postings; a link to the page\'s own address is not (#3877)', async () => {
  // #3877: the page's own path read as "the page itself" for every link whose ids had no 5-digit number (/viewjob?jk=abc123), so a list of
  // same-path postings with letter ids read as none
  const page = await browser.newPage();   // fixtures/visits/letter-ids.html, opened at the address of its own last link
  try {
    await page.goto(`${base}/letter-ids.html?jk=abc123`);
    const linked = await call(page, 'extractPage');
    assert.deepEqual(linked.cards.map(card => new URL(card.url).search).filter(search => search.startsWith('?jk=')), ['?jk=def456', '?jk=ghi789', '?jk=jkl012'],
      'three postings; the page\'s own address, the same with a param added (Gitar on #4278) and its next page are the page');
  } finally { await page.close(); }
});

test('the next page is the pager\'s next number, never the top menu\'s marked link', async () => {
  const {page} = await open('attribute');
  try {
    await page.evaluate(`document.body.insertAdjacentHTML('afterbegin', '<a href="https://other.example/next">Next</a>')`);   // a "Next" to another site comes first (Gitar on #3866)
    assert.equal(await call(page, 'goNext'), 'page number');
    assert.equal(await page.evaluate('document.body.dataset.pressed'), 'page 2');
  } finally { await page.close(); }
});
