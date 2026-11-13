// The Always on card's "this computer only" rows: every row has its words in all 7 languages, and none promises a Mac or a cloud read (owner, 13 Nov 2026: sign-ins stay on the computer).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ROWS} from '../../../renderer/always-on-device-only-words.js';

const LANGS = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const catalogs = Object.fromEntries(await Promise.all(LANGS.map(async lang =>
  [lang, (await import(`../../../i18n/catalogs/helpers/${lang}-more.js`)).messages])));
const keys = ['deviceOnlyLead', 'deviceOnlyPill', ...ROWS.flatMap(([, , title, line]) => [title, line])];

test('LinkedIn sign-in and Gmail & Calendar are the rows, in that order', () => {
  assert.deepEqual(ROWS.map(([id]) => id), ['linkedin', 'google']);
});

test('every row word exists in all 7 languages, and the reason names security', () => {
  for (const lang of LANGS) for (const key of keys) assert.ok(catalogs[lang][key]?.trim(), `${lang}.${key}`);
  for (const [, , , line] of ROWS) assert.match(catalogs.en[line], /^For your security, .* never leaves this computer/);
});

test('the words say "this computer", never "this Mac" (the app runs on Windows too)', () => {
  for (const lang of LANGS) for (const key of keys) assert.doesNotMatch(catalogs[lang][key], /\bMac\b/, `${lang}.${key}`);
});

class FakeNode {
  constructor(tag) { Object.assign(this, {tag, children: [], dataset: {}, className: '', textContent: '', title: ''}); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener() {}
  setAttribute(name, value) { this[name] = value; }
  get classList() { return {add: name => { this.className = `${this.className} ${name}`.trim(); }, contains: name => this.className.split(' ').includes(name)}; }
  all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) if (c instanceof FakeNode) c.all(pred, out); return out; }
  querySelector(css) { return this.all(node => node !== this && node.className.split(' ').includes(css.slice(1)))[0] || null; }
  text() { return this.textContent + this.children.map(child => (typeof child === 'string' ? child : child.text?.() ?? '')).join(''); }
}

test('the block mounts once into each Always on card, with a dimmed row per sign-in and its words', async () => {
  globalThis.Node = FakeNode;
  globalThis.document = {createElement: tag => new FakeNode(tag), createElementNS: (_, tag) => new FakeNode(tag), body: new FakeNode('body'), addEventListener() {}, querySelector: () => null};
  globalThis.window ??= {addEventListener() {}};
  const {mountDeviceOnly} = await import('../../../renderer/always-on-device-only.js');
  const cards = {'setting-cloud': new FakeNode('div'), 'setting-hosted': new FakeNode('div')};
  const doc = {getElementById: id => cards[id] || null};
  mountDeviceOnly(doc);
  mountDeviceOnly(doc);   // init runs again on a reload of the page: still one block
  for (const card of Object.values(cards)) {
    const blocks = card.all(node => node.className.split(' ').includes('aon-device-only'));
    assert.equal(blocks.length, 1);
    const rows = card.all(node => node.dataset.deviceOnly);
    assert.deepEqual(rows.map(row => row.dataset.deviceOnly), ['linkedin', 'google']);
    assert.ok(rows.every(row => row.className.includes('is-device-only')));
    assert.match(blocks[0].text(), /LinkedIn with your sign-in.*This computer only.*Gmail & Calendar/s);
  }
});
