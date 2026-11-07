// Real form reads and panel rows localize only private synthetic CAPTCHA identities, never employer labels or matcher payloads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadJsdom, openPage} from './helpers/page.js';
import {catalogs} from '../../extension/locales.js';

const JSDOM = await loadJsdom();
const read = file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8');
const canonical = 'Confirm you are not a robot';
const html = `<form><label for="employer">${canonical}</label><input id="employer" required>
  <div id="robot"><iframe title="Fictional robot check"></iframe><textarea name="g-recaptcha-response" hidden></textarea></div>
  <button type="submit">Submit</button></form>`;

test('synthetic CAPTCHA row uses the selected language while identical employer prose and canonical field objects stay unchanged', async () => {
  assert.ok(JSDOM, 'the existing jsdom dependency is required; never install during a task');
  const {window} = openPage(JSDOM, html), {document} = window;
  const forbidden = [], messages = [], flashes = [];
  let locale = 'en', change;
  try {
    window.fetch = () => {forbidden.push('network'); throw new Error('unexpected network');};
    document.querySelector('form').addEventListener('submit', event => {event.preventDefault(); forbidden.push('submit');});
    document.querySelector('iframe').addEventListener('click', () => forbidden.push('captcha interaction'));
    window.chrome = {runtime: {sendMessage: async message => {
      messages.push(message.type);
      if (message.type !== 'panelLocale') {forbidden.push('transport'); throw new Error('unexpected request');}
      return {locale, messages: catalogs[locale], english: catalogs.en};
    }}, storage: {onChanged: {addListener: fn => {change = fn;}}}};
    for (const file of ['i18n-format.js', 'panel-i18n.js', 'panel-form.js', 'panel-review-view.js']) window.eval(read(file));
    await window.__jobadabraPanelI18n.ready;
    const form = window.__jobadabraPanelForm;
    const fields = form.fields(), employer = fields.find(f => f.el.id === 'employer'), synthetic = fields.find(f => f.el.tagName === 'IFRAME');
    assert.equal(fields.length, 2); assert.ok(employer && synthetic);
    const before = fields.map(field => JSON.stringify({...field, el: field.el.tagName}));
    const keys = Reflect.ownKeys(synthetic);
    const root = document.createElement('div'); root.innerHTML = '<section class="left"><h4></h4><p class="knock"></p><div class="list"></div></section>';
    const view = window.__jobadabraPanelView({$: selector => root.querySelector(selector), KNOCKOUT: form.KNOCKOUT, AGREE: form.AGREE,
      flash: el => flashes.push(el), written: {review: () => forbidden.push('answer review')}});
    for (const chosen of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
      locale = chosen; change({extensionLanguage: {newValue: chosen}}, 'local');
      await new Promise(resolve => setImmediate(resolve));
      view.renderRemaining({pageMark: '', moved: false, shown: fields, state: {left: 2, busy: false, over: true}});
      const rows = root.querySelectorAll('.list .item');
      assert.equal(rows.length, 2);
      assert.equal(rows[0].children[1].textContent, canonical, 'employer lookalike stays byte-exact');
      assert.equal(rows[1].children[1].textContent, catalogs[chosen]['panel.syntheticCaptcha']);
      if (chosen !== 'en') assert.notEqual(rows[1].children[1].textContent, canonical);
      assert.equal(form.isSyntheticCaptcha(synthetic), true); assert.equal(form.isSyntheticCaptcha(employer), false);
      assert.equal(form.isSyntheticCaptcha({...synthetic}), false, 'a copied DTO has no private identity');
      assert.equal(synthetic.label, canonical); assert.equal(form.find(canonical, [synthetic]), synthetic);
      assert.equal(form.find(canonical, [employer]), employer);
      assert.deepEqual(fields.map(field => JSON.stringify({...field, el: field.el.tagName})), before);
      assert.deepEqual(Reflect.ownKeys(synthetic), keys);
      assert.equal(synthetic.required, true); assert.equal(synthetic.filled, false); assert.equal(synthetic.ai, false); assert.equal(synthetic.byUs, false);
      rows[0].onclick(); rows[1].onclick();
      assert.equal(flashes.at(-2), employer.el); assert.equal(flashes.at(-1), synthetic.el);
    }
    assert.equal(messages.length, 8, 'only display bundles are fetched');
    assert.deepEqual(forbidden, [], 'no fill, submit, captcha interaction or app request occurs');
  } finally { window.close(); }
});

test('fresh synthetic reads retain response-box readiness and private identity without adding payload keys', () => {
  assert.ok(JSDOM);
  for (const response of ['<textarea name="g-recaptcha-response" hidden></textarea>', '<textarea name="h-captcha-response" hidden></textarea>', '<input name="cf-turnstile-response" type="hidden">']) {
    const fixture = html.replace('<textarea name="g-recaptcha-response" hidden></textarea>', response);
    const {window} = openPage(JSDOM, fixture);
    try {
      window.eval(read('panel-form.js'));
      const form = window.__jobadabraPanelForm, before = form.fields().find(f => f.el.tagName === 'IFRAME');
      assert.equal(before.filled, false);
      window.document.querySelector('[name$="captcha-response"], [name="cf-turnstile-response"]').value = 'fictional-existing-widget-response';
      const after = form.fields().find(f => f.el.tagName === 'IFRAME');
      assert.equal(after.filled, true); assert.equal(after.required, true); assert.equal(after.label, canonical);
      assert.equal(after.el, before.el); assert.equal(form.isSyntheticCaptcha(after), true);
      assert.deepEqual(Reflect.ownKeys(after).sort(), ['ai', 'byUs', 'el', 'filled', 'label', 'required']);
      assert.equal(form.find(canonical, [after]), after);
    } finally { window.close(); }
  }
});
