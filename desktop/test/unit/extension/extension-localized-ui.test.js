// Run localized options and popup with a minimal fictional DOM and mocked Chrome transport; no live browser or app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {catalogs, cacheDesktopLocale} from '../../../../extension/i18n.js';

const root = new URL('../../../../extension/', import.meta.url);
registerHooks({load(url, context, next) {
  if (url === new URL('flow.js', root).href) return {format:'module', shortCircuit:true, source:`
    export const settings = () => chrome.storage.local.get();
    export const pair = async () => ({workerUrl:'http://127.0.0.1:47111',token:'fictional'});
    export const api = async () => ({matched:false});`};
  return next(url, context);
}});
const settle = () => new Promise(resolve => setImmediate(resolve));
function environment(file, initial = {}) {
  const html = fs.readFileSync(new URL(file, root), 'utf8');
  const nodes = [], byId = new Map(), listeners = [];
  const node = (tag = '') => ({dataset:{}, textContent:'', value:'', checked:false, hidden:/\shidden\b/.test(tag), classList:{add() {}},
    handlers:{}, children:[], append(value) { this.children.push(value); }, addEventListener(name, fn) { this.handlers[name] = fn; }});
  for (const [tag] of html.matchAll(/<[^/!][^>]*>/g)) {
    const item = node(tag);
    for (const [, key, value] of tag.matchAll(/data-i18n(?:-(title|placeholder))?="([^"]+)"/g)) item.dataset[key === 'title' ? 'i18nTitle' : key === 'placeholder' ? 'i18nPlaceholder' : 'i18n'] = value;
    const id = /\bid="([^"]+)"/.exec(tag)?.[1]; if (id) byId.set(id, item);
    nodes.push(item);
  }
  const stored = {workerUrl:'https://worker.invalid',token:'fictional', ...initial};
  const get = async () => ({...stored});
  const set = async values => {
    const changes = {};
    for (const [key,value] of Object.entries(values)) { if (stored[key] !== value) changes[key] = {newValue:value}; stored[key] = value; }
    if (Object.keys(changes).length) for (const listener of listeners) listener(changes, 'local');
  };
  globalThis.document = {documentElement:{},getElementById:id => byId.get(id),createElement:() => node(),
    querySelectorAll:selector => nodes.filter(item => Object.hasOwn(item.dataset, selector === '[data-i18n]' ? 'i18n' : selector === '[data-i18n-title]' ? 'i18nTitle' : 'i18nPlaceholder'))};
  globalThis.window = {addEventListener() {}};
  globalThis.chrome = {storage:{local:{get,set},session:{get:async()=>({})},onChanged:{addListener:fn=>listeners.push(fn)}},
    permissions:{contains:async()=>false},runtime:{openOptionsPage(){}},tabs:{query:async()=>[]}};
  return {byId,stored,set};
}

test('options defaults to Follow desktop, offers seven native names, preserves connection and consent settings', async () => {
  const env = environment('options.html', {acceptConsents:false});
  await import(new URL('options.js', root));
  assert.equal(env.byId.get('displayLanguage').children.length, 8);
  assert.equal(env.byId.get('displayLanguage').value, 'desktop');
  assert.equal(env.byId.get('acceptConsents').checked, false);
  const url = env.byId.get('workerUrl').value;
  await env.set({desktopDisplayLocale:'ru'}); await settle();
  assert.equal(globalThis.document.documentElement.lang, 'ru');
  assert.equal(env.byId.get('save').textContent, catalogs.ru.save);
  assert.equal(env.byId.get('workerUrl').value, url);
  env.byId.get('displayLanguage').value = 'ro';
  await env.byId.get('displayLanguage').handlers.change(); await settle();
  await env.set({desktopDisplayLocale:'fr'}); await settle();
  assert.equal(globalThis.document.documentElement.lang, 'ro');
  assert.equal(env.stored.extensionLanguage, 'ro');
  assert.equal(env.stored.acceptConsents, false);
});

test('popup defaults to English and redraws translated connection status on later desktop changes', async () => {
  const env = environment('popup.html');
  await import(new URL('popup.js', root)); await settle();
  assert.equal(env.byId.get('settings').textContent, 'Settings');
  for (const locale of ['ru','ro','de','fr','it','es']) {
    await env.set({desktopDisplayLocale:locale}); await settle();
    assert.equal(env.byId.get('settings').textContent, catalogs[locale].settings);
    assert.equal(env.byId.get('status').textContent, catalogs[locale].connectedWorker);
  }
});

test('answered older desktop resets cached language; transport only writes the rebuildable locale', async () => {
  const env = environment('popup.html', {desktopDisplayLocale:'ru',profile:{name:'Fictional {pages} <b>Candidate</b>'}});
  await cacheDesktopLocale(globalThis.chrome.storage.local, undefined);
  assert.equal(env.stored.desktopDisplayLocale, 'en');
  await cacheDesktopLocale(globalThis.chrome.storage.local, 'ro');
  assert.deepEqual(env.stored.profile, {name:'Fictional {pages} <b>Candidate</b>'});
  assert.equal(env.stored.token, 'fictional');
});
