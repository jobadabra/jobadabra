// "Mac" in the window's words on Windows (owner, 9 Oct 2026: "Not installed on this Mac" on a PC). Every piece of text the window or the app shows is passed through
// renderer/os.js on Windows, so the test runs each line of the renderer and lib through the same swap: a "Mac" that survives it would be shown to a PC user.
// A line may keep one on purpose (listed below, with why); a tip that only the Mac has is marked data-mac-only and hidden on Windows.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {osText} from '../renderer/os.js';

const root = fileURLToPath(new URL('..', import.meta.url));   // not .pathname: on Windows that is /D:/… (CI red, 9 Oct 2026)
const walk = dir => readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const KEPT = [
  'Mac schedule', 'Mac (you)',                  // the Trigger value written to the Notion Runs database: data, not display (a schema change of its own)
  'can only be asked of a Mac',                 // the Windows branch says why this PC does it by hand
];

test('after the Windows swap no line of the renderer or lib still says Mac', () => {
  const left = ['renderer', 'lib'].flatMap(walk).filter(file => /\.(js|html)$/.test(file) && !file.replace(/\\/g, '/').endsWith('renderer/os.js'))   // \ on Windows (CI red, 9 Oct 2026)
    .flatMap(file => readFileSync(join(root, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line.trim()])
      .filter(([, , line]) => !/^(\/\/|\*|<!--)/.test(line) && !line.includes('data-mac-only') && !KEPT.some(text => line.includes(text))
        && /\bMac\b/.test(osText(line.replace(/\bplatform\b.*|darwin.*/, ''), 'win32')) && !/(['"])mac\1|\.mac\b|mac:|process\.platform|navigator\.platform/.test(line))
      .map(([f, n, line]) => `${f}:${n}: ${line.slice(0, 90)}`));
  assert.deepEqual(left, []);
});

// Owner, 2 Nov 2026 (Windows screenshot "Show in Finder"): the test above assumes every word the app shows passes through renderer/os.js. Two kinds of surface do
// not: a native dialog/notification/menu (main process) and a window built without the preload (the CV review page). They swap their own words, and this
// class test finds the ones that did not.
const mainCode = () => [...walk('lib'), 'main.js'].filter(file => /\.js$/.test(file)).map(file => [file.replace(/\\/g, '/'), readFileSync(join(root, file), 'utf8')]);
const NATIVE = /dialog\.show|new Notification|setToolTip|Menu\.build|Tray\(/;

test('a native dialog, notification or menu never shows a Mac-only word on Windows', () => {
  const left = mainCode().filter(([, source]) => NATIVE.test(source)).flatMap(([file, source]) => source.split('\n').map((line, i) => [file, i + 1, line])
    .filter(([, , line]) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/osText\(|platform|[lL]og\(/.test(line))   // a log line is for us, not shown
    .filter(([, , line]) => [...line.replace(/\s\/\/.*$/, '').matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].some(([, , text]) => osText(text, 'win32') !== text))
    .map(([f, n, line]) => `${f}:${n}: ${line.trim().slice(0, 90)}`));
  assert.deepEqual(left, [], 'wrap the text in osText(text, process.platform) (renderer/os.js): the dialog is not a window os.js runs in');
});

// A window with no preload (and so no os.js) must swap its own words. Every BrowserWindow is listed with why its words are right on Windows; a new one fails here
// until someone decides.
const WINDOWS = {
  'lib/main-window.js': {count: 2, why: 'the app window runs renderer/os.js; the second shows Notion\'s own page'},
  'lib/cv-windows.js': {count: 3, why: 'two hidden print windows; the review window\'s page is written by lib/cv.js reviewPage through osText (test/cv.test.js)'},
  'lib/cv-look.js': {count: 1, why: 'hidden: measures the CV, shows nothing'},
  'lib/page-render.js': {count: 1, why: 'hidden: renders an employer page for the engine'},
  'lib/linkedin-signin-window.js': {count: 1, why: 'LinkedIn\'s own sign-in page, in LinkedIn\'s words; our only text is the title "Sign in to LinkedIn · Jobadabra", with no Mac key or menu word'},
};

test('every window the main process opens is accounted for on Windows', () => {
  const found = Object.fromEntries(mainCode().map(([file, source]) => [file, (source.match(/new BrowserWindow\(/g) || []).length]).filter(([, count]) => count));
  assert.deepEqual(found, Object.fromEntries(Object.entries(WINDOWS).map(([file, {count}]) => [file, count])),
    'a new BrowserWindow: add it to WINDOWS with why its words are right on Windows (a window without the preload never runs renderer/os.js)');
});

// notify() (lib/app-notify.js) is the one choke point for the app's native notifications: its callers write plain Mac words, it swaps them. A second
// `new Notification` elsewhere must say how its words are made right (the reminder's text is a session's own brief, never swapped).
test('every native notification the app builds swaps its words for Windows', () => {
  const found = mainCode().flatMap(([file, source]) => source.split('\n').filter(line => /new Notification\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)).map(line => [file, /osText\(/.test(line)]));
  assert.deepEqual(found, [['lib/app-notify.js', true], ['lib/app-reminders.js', false]], 'a new Notification: swap its fixed words with osText(…, process.platform), or list why it needs none');
});
