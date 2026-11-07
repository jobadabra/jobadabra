// Native notification sinks preserve formatted and personal text exactly, with no real OS, storage or network access.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAppNotify} from '../../../lib/app-notify.js';
import {logFile} from '../../../lib/log.js';

function fixture(supported = true) {
  const native = [], window = [];
  class Notification {
    static isSupported() {return supported;}
    constructor(options) {native.push(options); this.handlers = new Map();}
    on(name, callback) {this.handlers.set(name, callback);}
    show() {this.handlers.get('show')?.();}
  }
  const {notify} = createAppNotify({DEMO: true, Notification, app: {isPackaged: false},
    getStorage: () => {throw new Error('native display must not access user storage');}, targets: {clean: target => target},
    toWindow: (...args) => window.push(args), getWindow: () => {throw new Error('tests never open the owner window');}});
  return {notify, native, window};
}

function windows(work) {
  const previous = Object.getOwnPropertyDescriptor(process, 'platform');
  const smoke = process.env.JOBADABRA_SMOKE, fetcher = globalThis.fetch;
  Object.defineProperty(process, 'platform', {value: 'win32'});
  delete process.env.JOBADABRA_SMOKE;
  globalThis.fetch = () => {throw new Error('native display must not use the network');};
  try {assert.equal(logFile(), null, 'no real app log is configured'); work();}
  finally {
    Object.defineProperty(process, 'platform', previous);
    globalThis.fetch = fetcher;
    if (smoke === undefined) delete process.env.JOBADABRA_SMOKE;
    else process.env.JOBADABRA_SMOKE = smoke;
  }
}

test('Windows native notifications do not rewrite formatted labels or personal values', () => windows(() => {
  const {notify, native, window} = fixture();
  const title = 'Fictional this Mac’s Keychain ⌘K {title}';
  const body = 'Готово: Fictional this Mac Keychain ⌘K {body}';
  notify(title, body, {view: 'sessions', session: 'fictional'}, 'warn');
  assert.deepEqual(native, [{title, body, silent: false}]);
  assert.deepEqual(window, []);
}));

test('the window fallback retains the same title, body, target and tone without native delivery', () => windows(() => {
  const {notify, native, window} = fixture(false);
  const title = 'Fictional this Mac ⌘K', body = 'Personal Keychain {body}', target = {view: 'sessions', session: 'fictional'};
  notify(title, body, target, 'warn');
  assert.deepEqual(native, []);
  assert.deepEqual(window, [['toast', {title, body, hint: false, target, tone: 'warn'}]]);
}));
