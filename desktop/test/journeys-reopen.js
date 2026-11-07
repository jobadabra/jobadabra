// J31: reopen a closed form with no browser tab, then retry after the extension can acknowledge it; never report dispatch alone as success.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';
import {registerSessionHandlers} from '../lib/session-handlers.js';

test('J31: an unconfirmed reopen fails, then a confirmed retry succeeds for the same session', async () => {
  terminals._reset();
  const {id} = terminals.startForm({id: 'reopen-j31', url: 'https://jobs.example.test/role', company: 'Fictional employer'});
  const handles = new Map();
  let bound = '', acknowledge = false, launches = 0;
  registerSessionHandlers({ipcMain: {handle: (name, fn) => handles.set(name, fn)}, appLog: () => {}, storage: {},
    getWindow: () => null, here: '', DEMO: false, dialog: {}, nativeImage: {}, pipeline: {}, server: {},
    apply: {openOne: () => { launches++; if (acknowledge) bound = 'new-tab'; return {ok: true}; }},
    review: {tabOf: () => bound, forget: () => {}, allStates: () => []}, focusTab: async () => 'none',
    verifyOpenedTab: true, pause: async () => {}});
  const press = () => handles.get('sessionReopen')({}, id, false);
  const failed = await press();
  assert.equal(failed.ok, false, 'URL dispatch with no form tab must not produce the success toast');
  assert.match(failed.error, /Chrome.*extension/i);
  acknowledge = true;
  assert.deepEqual(await press(), {ok: true, reset: false});
  assert.equal(launches, 2, 'failure keeps immediate retry available');
  assert.equal(terminals.get(id).id, id, 'the same application session is retained');
});
