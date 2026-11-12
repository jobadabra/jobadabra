// The read loop with cards that have no address yet (#3710 PR 2, B): extension/visit.js presses them through addressByPress and sends the app every card
// that got an address, the ones read by link or id included; a card the press could not place is not sent. Page functions are stand-ins by name.
import assert from 'node:assert/strict';
import {test} from 'node:test';

test('cards with no address are pressed for one, and the app gets every card that has an address', async () => {
  const store = {}, ran = [], sent = [];
  const page = {url: 'https://list.example/results/?sel=900001', title: 'Results', html: '', cards: [{title: 'Read by link', url: 'https://list.example/results/?sel=900001', lines: ['Read by link', 'Line']}],
    pressCards: [{key: '1', title: 'Pressed one', lines: ['Pressed one', 'Line']}, {key: '2', title: 'Never placed', lines: ['Never placed', 'Line']}]};
  globalThis.chrome = {
    storage: {session: {get: async () => ({}), set: async items => Object.assign(store, items), remove: async () => {}}, local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}},
    tabs: {get: async () => ({id: 4, url: page.url}), update: async () => ({}), reload: async () => {}},
    action: {setBadgeText: async () => {}, setTitle: async () => {}},
    runtime: {getPlatformInfo: async () => ({}), sendMessage: async () => ({})},
    scripting: {executeScript: async ({func, args}) => {
      ran.push({name: func?.name, args});
      if (func?.name === 'extractPage') return [{result: page}];
      if (func?.name === 'addressByPress') return [{result: {addresses: {1: 'https://list.example/results/?sel=900002'}, left: false}}];
      if (func?.name === 'goNext') return [{result: 'none'}];
      return [{result: undefined}];
    }},
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/extension/visit-read') sent.push(JSON.parse(init.body));
    return {ok: true, status: 200, json: async () => (path === '/extension/visit-read' ? {ok: true, jobs: 2, added: 2, name: 'list.example'} : {})};
  };
  try {
    const {readSite} = await import('../../../../extension/visit.js');
    await readSite(4, {pages: 1});
    const press = ran.find(call => call.name === 'addressByPress');
    assert.ok(press, 'positive control: the unplaced cards were pressed');
    assert.deepEqual(press.args[0].keys, ['1', '2']);
    assert.equal(sent.length, 1, 'the page was sent to the app once');
    assert.deepEqual(sent[0].cards.map(card => [card.title, card.url]), [['Read by link', 'https://list.example/results/?sel=900001'], ['Pressed one', 'https://list.example/results/?sel=900002']]);
  } finally {
    delete globalThis.chrome;
    globalThis.fetch = realFetch;
  }
});
