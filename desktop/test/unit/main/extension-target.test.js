// "Where is the person's extension, and can the app open its page?" has ONE owner: the extension's own check-in (it names its id), with the browser-profile scan only as the fallback
// (lib/extension-target.js). Owner, 3 Nov 2026: Settings → Connections said "Connected · v0.9.755" and "Turn on LinkedIn" said "Chrome extension needed". Chrome kept the unpacked copy in
// Preferences with no manifest and a path outside the app's own folder, so the scan found nothing while the check-in proved it was there.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import * as ext from '../../../lib/extension-install.js';
import {notOpened} from '../../../renderer/linkedin-words.js';
import {extensionTarget, linkedinPageOpener, noPageReason, olderThan, openExtensionPage} from '../../../lib/extension-target.js';

const ID = 'gpffoneapcfceflfmfgedkcfbommgcfk';
// The owner's Chrome, as read from his machine (mac-07, 3 Nov 2026): location 4 (unpacked), the repo's folder, NO manifest.
const OWNERS_PREFS = JSON.stringify({extensions: {settings: {[ID]: {location: 4, path: '/Users/mac/jobadabra/extension', disable_reasons: []}}}});
const platforms = key => key.split('/').join(path.sep);
const files = {'Default/Secure Preferences': OWNERS_PREFS};
const chrome = {list: () => ['Default'], exists: at => Object.keys(files).some(key => at.endsWith(platforms(key))), read: at => files[Object.keys(files).find(k => at.endsWith(platforms(k)))]};
const APP_FOLDER = '/Applications/Jobadabra.app/Contents/Resources/extension';
const seen = {at: 1762140000000, version: '0.9.755', id: ID};

test('the owner\'s scenario: the scan finds nothing (so it cannot be the owner of "the extension is here"), the check-in opens the page', async () => {
  const scanned = ext.inProfile('/support/Google/Chrome', {...chrome, folder: APP_FOLDER});
  assert.deepEqual(scanned, [], 'positive control: the profile scan alone misses this copy, which is why the toast blamed the extension');
  const opened = [];
  const result = await openExtensionPage('linkedin.html', {seen, found: scanned, open: async (url, options) => { opened.push([url, options.browser]); return true; }});
  assert.equal(result, true);
  assert.deepEqual(opened, [[`chrome-extension://${ID}/linkedin.html`, '']], 'the page of the id it reported, in the default Chromium browser');
});

test('the scan still opens the page when the extension has not checked in yet; the check-in\'s id wins when both know a copy', async () => {
  const found = [{id: 'other', app: 'Brave Browser', current: true}, {id: ID, app: 'Google Chrome', current: false}];
  assert.deepEqual(extensionTarget({seen: null, found}), {id: 'other', browser: 'Brave Browser'}, 'no check-in: the app\'s own copy by the scan');
  assert.deepEqual(extensionTarget({seen, found}), {id: ID, browser: 'Google Chrome'}, 'a check-in: that id, in the browser that holds it');
  assert.equal(extensionTarget({seen: null, found: []}), null);
  assert.equal(extensionTarget({seen: {at: 1, version: '0.9.755', id: ''}, found: []}), null, 'a check-in that names no known id is not a target');
});

test('a toast can never blame the extension while it is connected: each failure says its own reason', () => {
  assert.equal(noPageReason({seen: null, found: [], latest: '0.9.755'}).reason, 'missing', 'never seen, never found: connect it');
  assert.equal(noPageReason({seen: {at: 1, version: '0.9.755', id: ''}, found: [], latest: '0.9.755'}).reason, 'unknown-copy', 'connected, but not a copy the app can open pages of');
  assert.deepEqual(noPageReason({seen, found: [], latest: '0.9.755'}), {reason: 'chrome', note: ''}, 'connected and current: the browser would not open');
  const older = noPageReason({seen: {at: 1, version: '0.9.700', id: ID}, found: [], latest: '0.9.755'});
  assert.equal(older.reason, 'chrome', 'an older copy is still connected: the reason is not "needed"');
  assert.match(older.note, /0\.9\.700[^]*0\.9\.755/, 'and the note says how to update it');
  assert.equal(noPageReason({seen: {at: 1, version: '0.9.800', id: ID}, found: [], latest: '0.9.755'}).note, '', 'a development copy NEWER than the app is never told it is older');
});

test('olderThan compares dotted numbers, not text', () => {
  assert.equal(olderThan('0.9.700', '0.9.755'), true);
  assert.equal(olderThan('0.9.755', '0.9.755'), false);
  assert.equal(olderThan('0.9.800', '0.9.755'), false);
  assert.equal(olderThan('0.9.99', '0.9.100'), true, '99 < 100 as numbers');
  assert.equal(olderThan('1.0', '0.9.755'), false);
});

// The whole press, as the handler wires it (linkedinPageOpener): the check-in, launchOnce, the scan and the reason, with a fake server and a fake browser.
test('the press as the app wires it: connected opens the page; a browser that will not open says "chrome", never "needed"; no check-in and no scan says "needed"', async () => {
  const urls = [];
  const press = ({checkIn, scan = [], opens = true}) => linkedinPageOpener({server: {extensionSeen: () => checkIn, latestExtension: () => '0.9.755'}, installed: () => scan, open: async url => { urls.push(url); return opens; }});
  assert.equal((await press({checkIn: seen})()).opened, true);
  assert.deepEqual(urls, [`chrome-extension://${ID}/linkedin.html`], 'the owner\'s scenario: no scan entry, a check-in id');
  const refused = await press({checkIn: seen, opens: false})();
  assert.deepEqual([refused.opened, refused.reason], [false, 'chrome']);
  const never = await press({checkIn: null})();
  assert.deepEqual([never.opened, never.reason], [false, 'missing'], 'nothing to open at all');
  const scanOnly = await press({checkIn: null, scan: [{id: 'zzz', app: 'Google Chrome', current: true}]})();
  assert.equal(scanOnly.opened, true, 'before its first check-in the scan still finds the app\'s own copy');
});

test('the toast has words for every reason, names the extension as connected only when it is, and never blames it for a newer copy', () => {
  const [title, body] = notOpened({opened: false, reason: 'missing', note: ''});
  assert.match(title, /Chrome extension needed/);
  assert.match(body, /Settings → Connections → Chrome extension/);
  for (const reason of ['unknown-copy', 'chrome']) {
    const [heading, text, place, tone] = notOpened({opened: false, reason, note: ''});
    assert.doesNotMatch(heading, /needed/, `${reason}: not "needed"`);
    assert.match(text, /connected/, `${reason}: says the extension is connected`);
    assert.deepEqual([place === undefined, tone], [false, 'warn']);
  }
  assert.match(notOpened({reason: 'chrome', note: 'Chrome runs Jobadabra extension 0.9.700, older than this app\'s 0.9.755: reload it once.'})[1], /0\.9\.700/, 'an older copy\'s note is added');
  assert.equal(notOpened(null)[0], 'Chrome extension needed', 'no answer at all reads as missing');
});

// Owner, 3 Nov 2026: "log every Turn on LinkedIn press and its outcome": one line per press, the way it was opened (check-in or scan), the browser and the reason; never a cookie.
test('every extension press leaves one app.log line: how the page was found, the browser, the outcome', async () => {
  const lines = [];
  const press = ({checkIn, scan = [], opens = true}) => linkedinPageOpener({server: {extensionSeen: () => checkIn, latestExtension: () => '0.9.755'}, installed: () => scan, open: async () => opens, log: (...line) => lines.push(line)});
  await press({checkIn: seen})();
  await press({checkIn: seen, opens: false})();
  await press({checkIn: null})();
  await press({checkIn: null, scan: [{id: 'zzz', app: 'Google Chrome', current: true}]})();
  assert.deepEqual(lines.map(([area, what, fields]) => [area, what, fields.path, fields.opened, fields.reason, fields.idSource, fields.browser]), [
    ['linkedin-jobs', 'press', 'extension', true, '', 'check-in', ''],
    ['linkedin-jobs', 'press', 'extension', false, 'chrome', 'check-in', ''],
    ['linkedin-jobs', 'press', 'extension', false, 'missing', 'none', ''],
    ['linkedin-jobs', 'press', 'extension', true, '', 'scan', 'Google Chrome'],
  ]);
});
