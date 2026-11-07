// Platform wording in trusted app copy (owner, 9 Oct 2026: "Not installed on this Mac" on a PC). The localization design (7 Nov 2026) adapts catalog templates before interpolation;
// renderer/os.js remains a compatibility export for explicit app-owned strings. This source guard checks supported wording, not arbitrary user DOM content.
// A line may keep one on purpose (listed below, with why); a tip that only the Mac has is marked data-mac-only and hidden on Windows.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {osText} from '../../../renderer/os.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));   // not .pathname: on Windows that is /D:/… (CI red, 9 Oct 2026)
const walk = dir => readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
// Exact non-display values stay stable: stored schemas, migration IDs and diagnostic context.
const NON_DISPLAY = {
  'lib/feedback-handlers.js': ['store: onNotion(storage)'],
  'lib/ready-auto.js': ["check('the Mac sleeps')", "check('the Mac shuts down')"],
  'lib/migrate.js': ["name: 'strategy from this Mac'", "name: 'employers from this Mac'", "name: 'runs from this Mac'"],
  'lib/run-history.js': ['Run: {title:', "block('paragraph', 'Run on this Mac before"],
  'lib/server-contact.js': ["keptSource = () => 'kept copy on this Mac'"],
};
const KEPT = [
  'Mac schedule', 'Mac (you)',                  // the Trigger value written to the Notion Runs database: data, not display (a schema change of its own)
  'can only be asked of a Mac',                 // the Windows branch says why this PC does it by hand
];

test('Mac device wording requires an explicit platform boundary, never an assumed DOM swap', () => {
  const left = ['renderer', 'lib'].flatMap(walk).filter(file => /\.js$/.test(file) && !file.replace(/\\/g, '/').endsWith('renderer/os.js'))   // \ on Windows (CI red, 9 Oct 2026)
    .flatMap(file => readFileSync(join(root, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line.trim()])
      .filter(([, , line]) => !/^(\/\/|\/\*|\*|<!--)/.test(line) && !line.includes('data-mac-only') && !KEPT.some(text => line.includes(text)) && !(NON_DISPLAY[file.replace(/\\/g, '/')] || []).some(text => line.includes(text))
        && /\bMac\b/.test(line.replace(/\s+\/\/.*$/, '').replace(/\bplatform\b.*|darwin.*/, '')) && !/osText\(|data-i18n|appLog\(|\blog\(/.test(line) && !/(['"])mac\1|\.mac\b|process\.platform|navigator\.platform/.test(line))
      .map(([f, n, line]) => `${f}:${n}: ${line.slice(0, 90)}`));
  assert.deepEqual(left, []);
});

// Native dialogs and preload-free windows use explicit trusted platform boundaries too (owner, 2 Nov 2026, Windows "Show in Finder").
// They must never rely on a renderer DOM observer; this class guard checks their fixed labels separately.
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
  'lib/main-window.js': {count: 2, why: 'the app window uses platform-aware catalog templates; the second shows Notion\'s own page'},
  'lib/cv-windows.js': {count: 3, why: 'two hidden print windows; the review window\'s page is written by lib/cv.js reviewPage through osText (test/unit/cv/cv.test.js)'},
  'lib/cv-look.js': {count: 1, why: 'hidden: measures the CV, shows nothing'},
  'lib/page-render.js': {count: 1, why: 'hidden: renders an employer page for the engine'},
  'lib/linkedin-signin-window.js': {count: 1, why: 'LinkedIn\'s own sign-in page, in LinkedIn\'s words; our only text is the title "Sign in to LinkedIn · Jobadabra", with no Mac key or menu word'},
};

test('every window the main process opens is accounted for on Windows', () => {
  const found = Object.fromEntries(mainCode().map(([file, source]) => [file, (source.match(/new BrowserWindow\(/g) || []).length]).filter(([, count]) => count));
  assert.deepEqual(found, Object.fromEntries(Object.entries(WINDOWS).map(([file, {count}]) => [file, count])),
    'a new BrowserWindow: add it to WINDOWS with why its words are right on Windows (a window without the preload never runs renderer/os.js)');
});

// Privacy: native sinks receive finished copy; platform substitutions belong to trusted templates before personal interpolation.
// The fixed-wording guard above covers app copy while this one prevents blanket rewriting at notification sinks.
test('native notification sinks never rewrite already formatted or personal text', () => {
  const found = mainCode().flatMap(([file, source]) => source.split('\n').filter(line => /new Notification\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)).map(line => [file, /osText\(/.test(line)]));
  assert.deepEqual(found, [['lib/app-notify.js', false], ['lib/app-reminders.js', false]], 'format fixed words at the trusted template boundary; never rewrite a finished notification');
});

// Privacy: page messages already interpolate through t(); wrapping their result rewrites personal values.
test('page renderers never apply platform substitutions to finished messages', () => {
  const found = walk('renderer/pages').flatMap(file => readFileSync(join(root, file), 'utf8').split('\n')
    .flatMap((line, index) => /\bosText\(/.test(line) ? [`${file}:${index + 1}`] : []));
  assert.deepEqual(found, [], 'adapt only the trusted template inside t(), before personal values are inserted');
});
