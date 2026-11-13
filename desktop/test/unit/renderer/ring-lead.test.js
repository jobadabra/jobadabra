// The score ring and the Match analysis lead (owner, 13 Nov 2026: "We should be realistic" · "The person needs to understand why the scoring is so low"):
// the panel leads with the ring's own number and the one-line why; an old score is a dashed ring with a refresh badge, no word under it.
// On a tiny stand-in for the DOM (the renderer only needs these calls).
import assert from 'node:assert/strict';
import {test} from 'node:test';

class FakeNode {
  constructor(tag) { Object.assign(this, {tag, children: [], listeners: {}, style: {setProperty() {}}, className: '', textContent: '', title: ''}); }
  append(...nodes) { this.children.push(...nodes.map(node => (typeof node === 'string' ? Object.assign(new FakeNode('#text'), {textContent: node}) : node))); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(kind, run) { this.listeners[kind] = run; }
  get classList() { return {add: name => { this.className = `${this.className} ${name}`.trim(); }, contains: name => this.className.split(' ').includes(name)}; }
  text() { return this.textContent + this.children.map(child => child.text?.() ?? '').join(''); }
  find(test) { return test(this) ? this : this.children.map(child => child.find?.(test)).find(Boolean); }
}
globalThis.Node = FakeNode;
globalThis.document = {createElement: tag => new FakeNode(tag), createElementNS: (_, tag) => new FakeNode(tag),
  body: new FakeNode('body'), addEventListener() {}, querySelector: () => null, documentElement: new FakeNode('html')};
globalThis.window ??= {addEventListener() {}};
const {fitRing} = await import('../../../renderer/fit-ring.js');
const {fitDetail} = await import('../../../renderer/pages/jobs-fit.js');

const PILOT = {fit: 25, reason: 'Career change: No aviation licence or flight hours on your CV',
  fit_detail: {parts: {role_fit: 20, location: 50, risk: 80}, strengths: 'Your search asked for this role', gaps: 'No flight hours'}};

test('an old score is a dashed ring with a refresh badge and keeps its number; a current one has no badge', () => {
  const old = fitRing(84, '', true), current = fitRing(84);
  assert.ok(old.classList.contains('is-old'));
  assert.equal(old.find(node => node.className === 'fit-old-badge') !== undefined, true);
  assert.equal(old.children[0].textContent, 84, 'the old number is still shown');
  assert.equal(current.classList.contains('is-old'), false);
  assert.equal(current.find(node => node.className === 'fit-old-badge'), undefined);
  assert.equal(fitRing(null, '', true).find(node => node.className === 'fit-old-badge'), undefined, 'no score, nothing to mark old');
});

test('the Match analysis leads with the ring\'s own number, then the why; What to check stays under it', () => {
  const panel = fitDetail(PILOT);
  const summary = panel.find(node => node.className === 'fit-summary');
  assert.equal(summary.text(), `25 · ${PILOT.reason}`, 'the same number as the ring, then the one line');
  assert.match(summary.children[0].className, /fit-lead-score low/);
  assert.match(panel.text(), /What to check|No flight hours/);
});

test('a job with a number and no reason still leads with its number; no number and no reason draws no lead', () => {
  assert.equal(fitDetail({fit: 70, reason: '', fit_detail: PILOT.fit_detail}).find(node => node.className === 'fit-summary').text(), '70');
  assert.equal(fitDetail({fit: null, reason: '', fit_detail: PILOT.fit_detail}).find(node => node.className === 'fit-summary'), undefined);
});
