// Session reminders route localized labels and unchanged session content to native and window notifications.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {createAppReminders} from '../../../lib/app-reminders.js';
import {sessionInputNotice} from '../../../lib/native-notices.js';

afterEach(() => setLocale('en'));

function fixture() {
  const native = [], window = [];
  class Notification {
    static isSupported() {return true;}
    constructor(options) {native.push(options);}
    on() {}
    show() {}
  }
  const reminders = createAppReminders({FOCUS_HOURS: [], Notification, dialog: {}, log() {}, notify() {}, skippedLoops: new Set(),
    getStorage: () => {throw new Error('session notices must not access real storage');}, targets: {clean: target => target},
    toWindow: (...args) => window.push(args), getWindow: () => {throw new Error('only a person clicking a notice opens a window');}});
  return {reminders, native, window};
}

test('a session question uses the active locale and retains its raw content and session target', () => {
  const {reminders, native, window} = fixture();
  const raw = 'Fictional this Mac Keychain ⌘K {title}';
  for (const locale of ['de', 'ru']) {
    setLocale(locale);
    const session = {id: locale, company: raw, title: 'SRE', brief: raw};
    reminders.sessionNeedsYou(session);
    const expected = sessionInputNotice({title: `${raw} · SRE`, brief: raw});
    assert.deepEqual(native.at(-1), expected, locale);
    assert.deepEqual(window.at(-1), ['toast', {...expected, target: {view: 'sessions', session: locale}, tone: 'warn'}], locale);
    reminders.sessionNeedsYou(session);
  }
  assert.equal(native.length, 2, 'the same unanswered question is not announced twice');
  assert.equal(window.length, 2);
});

test('an empty session brief uses a localized fallback rather than inventing session content', () => {
  const {reminders, native, window} = fixture();
  setLocale('fr');
  reminders.sessionNeedsYou({id: 'empty', title: 'Fictional {title}'});
  const expected = sessionInputNotice({title: 'Fictional {title}'});
  assert.deepEqual(native[0], expected);
  assert.equal(window[0][1].body, expected.body);
  assert.notEqual(expected.body, 'Claude needs your input');
});
