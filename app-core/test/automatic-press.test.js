// Full automation's one press (extension/background-submit.js automaticPress, run in the extension's isolated world with page/submit-press.js): the tagged button goes through the press floor
// and is marked as the extension's own. Why (10 Nov 2026, owner: "Fix it now (Recommended)"): the press used to run in the page's own world, where the floor does not exist, so a "Withdraw application"
// named as the submit was clicked, and the submit it fired reached the app as the person's own press (no "applied" e-mail). The real browser: desktop/integration/extension/full-automation-press.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';
import { automaticPress } from '../../extension/background-submit.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

/** One page with the floor loaded, `markup` inside its form; -> {window, sent: the panel's messages, submits: the form's submit events}. */
async function pageWith(markup, { floor = true } = {}) {
  const { window } = openPage(JSDOM, `<form><label for="n">Name *</label><input id="n" required value="Ada">${markup}</form>`);
  const sent = [], submits = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  if (floor) window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.document.addEventListener('submit', (event) => { submits.push(event.submitter?.id || ''); event.preventDefault(); });
  globalThis.document = window.document;
  globalThis.__jobadabraSubmitPress = window.__jobadabraSubmitPress;
  return { window, sent, submits };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('the tagged Submit is pressed once, as the extension\'s own press: the form sends and the panel never reports the person\'s submit', { skip: !JSDOM }, async () => {
  const { window, sent, submits } = await pageWith('<button id="go" type="submit" data-jobadabra-press="t1">Submit application</button>');
  assert.deepEqual(automaticPress('t1'), { pressed: true });
  await settle();
  assert.deepEqual(submits, ['go']);
  assert.equal(sent.filter((message) => message.type === 'submitted').length, 0, 'the panel took the automatic press for the person\'s');
  assert.equal(window.document.querySelector('[data-jobadabra-press]'), null, 'the tag is used once');
  window.close();
});

test('a Withdraw, Delete or Decline named as the submit is never pressed', { skip: !JSDOM }, async () => {
  for (const words of ['Withdraw application', 'Delete my account', 'Delete all data']) {
    const { window, submits } = await pageWith(`<button id="go" type="submit" data-jobadabra-press="t2">${words}</button>`);
    assert.deepEqual(automaticPress('t2'), { pressed: false, why: 'refused' }, words);
    await settle();
    assert.deepEqual(submits, [], words);
    window.close();
  }
});

test('no floor in this world, another token, two tags or a disabled button: nothing is pressed', { skip: !JSDOM }, async () => {
  const cases = [
    ['<button id="go" type="submit" data-jobadabra-press="t3">Submit application</button>', 't3', { floor: false }, 'no_floor'],
    ['<button id="go" type="submit" data-jobadabra-press="t3">Submit application</button>', 'other', {}, 'changed'],
    ['<button id="go" type="submit" data-jobadabra-press="t3">Submit application</button><button id="b" type="submit" data-jobadabra-press="t3">Send</button>', 't3', {}, 'changed'],
    ['<button id="go" type="submit" disabled data-jobadabra-press="t3">Submit application</button>', 't3', {}, 'changed'],
  ];
  for (const [markup, token, options, why] of cases) {
    const { window, submits } = await pageWith(markup, options);
    assert.deepEqual(automaticPress(token), { pressed: false, why }, markup);
    await settle();
    assert.deepEqual(submits, [], markup);
    window.close();
  }
});

// Guard: safety — the test that let this through (app-core/test/submit-press.test.js) runs the floor and the press in one JSDOM world, so a press run in the page's world looked floored.
// The page-world check may not reach for the floor (it is not there), and the press runs in the extension's world (no `world: 'MAIN'` on its executeScript).
test('the page-world check never reaches for the floor, and the press runs in the extension\'s world', async () => {
  const { submissionPage } = await import('../../extension/background-submit.js');
  assert.doesNotMatch(submissionPage.toString(), /__jobadabra(SubmitPress|Press)\b/, 'submissionPage runs in the page\'s world, where page/submit-press.js does not exist');
  const apply = read('extension/background-apply.js');
  const own = apply.match(/const own = [^\n]+/)?.[0] || '';
  assert.match(own, /executeScript\(/);
  assert.doesNotMatch(own, /world:/, 'the press must run in the extension\'s isolated world, where the floor lives');
  assert.match(apply, /await own\(tab\.id, frameId, automaticPress,/);
});
