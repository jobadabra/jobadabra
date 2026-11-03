// "Import from LinkedIn" in the window (renderer/pages/linkedin-import.js): the Profile button, the ⌘K entry, every channel the page calls is exposed and answered, the EU note is said,
// and the page never holds a key. Static checks of the sources, like experience-page.test.js; the engine and rows are guarded by linkedin-import*.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../renderer/index.html'), page = read('../renderer/pages/linkedin-import.js'), nav = read('../renderer/pages/nav.js'), app = read('../renderer/app.js');
const preload = read('../preload.cjs'), handlers = read('../lib/linkedin-import-handlers.js'), experienceHandlers = read('../lib/experience-handlers.js');

test('the Profile CV card has the button, the window starts the page and ⌘K opens the dialog', () => {
  assert.match(html, /id="cv-import-linkedin"[^>]*>[^]*Import from LinkedIn/);
  assert.match(app, /import \{init as linkedinImport\} from '\.\/pages\/linkedin-import\.js'/);
  assert.match(app, /^linkedinImport\(\);/m);
  assert.match(nav, /add\('Profile', 'Import from LinkedIn'[^]*openImport\(\)/);
});

test('every channel the page calls is in the preload and answered by the app', () => {
  for (const name of ['linkedinImportState', 'linkedinImportRun', 'linkedinImportApply', 'linkedinImportCancel', 'linkedinImportDisconnect']) {
    assert.match(page, new RegExp(`pilot\\.${name}`), `${name} is called`);
    assert.match(preload, new RegExp(`${name}: call\\('${name}'\\)`), `${name} is in the preload`);
    assert.match(handlers, new RegExp(`ipcMain.handle\\('${name}'`), `${name} has a handler`);
  }
  assert.match(preload, /onLinkedinImportStep: callback => ipcRenderer\.on\('linkedinImportStep'/);
  assert.match(handlers, /sendStep\('linkedinImportStep'/);
  assert.match(experienceHandlers, /registerLinkedinImportHandlers\(\{DEMO, ipcMain, shell, storage, getWindow\}\)/, 'the handlers are registered at startup');
});

test('the dialog says who can use it, offers the data file, and the page never holds or shows a key', () => {
  assert.match(page, /For LinkedIn members in the EU, EEA and Switzerland\. Elsewhere, use your LinkedIn data file\./);
  assert.match(page, /Use your LinkedIn data file/);
  assert.match(page, /Disconnect/);
  assert.doesNotMatch(page, /access_token|expires_in|\btoken\b|Authorization|api\.linkedin\.com/i, 'the key and the API stay in the main process');
  assert.doesNotMatch(page, /type: 'password'|type="password"/, 'no password is ever typed here');
});

test('a differing Your details row is shown with both values; nothing is added until Add; Add counts the ticked rows', () => {
  assert.match(page, /Yours: \$\{item\.current\}[^]*LinkedIn: \$\{item\.linkedin\}/);
  assert.match(page, /differs, unticked/);
  assert.match(page, /checked: !!item\.ticked/);
  assert.match(page, /Nothing changes until you press Add; your CV is not edited\./);
  assert.match(page, /Add \$\{n\} selected/);
  assert.match(page, /add\.disabled = !n/);
});

test('a stale run never draws into a newer dialog, and after a 429 or a changed API there is no Try again (that would retry a 429)', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/linkedin-import.js', import.meta.url), 'utf8');
  assert.match(page, /const mine = \+\+runId;[^]*mine !== runId\) return;/, 'a late answer of a closed or replaced run is ignored');
  assert.match(page, /addEventListener\('close', \(\) => \{ runId\+\+; window\.pilot\.linkedinImportCancel\(\)/, 'Escape and the backdrop cancel the wait too');
  assert.match(page, /\['rate', 'version'\]\.includes\(stopped\)/, 'no Try again after rate or version');
});
