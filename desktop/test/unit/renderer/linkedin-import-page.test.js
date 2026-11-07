// "Import from LinkedIn" in the window (renderer/pages/linkedin-import.js): the Profile button, the ⌘K entry, every channel the page calls is exposed and answered, the EU note is said,
// and the page never holds a key. Static checks of the sources, like experience-page.test.js; the engine and rows are guarded by linkedin-import*.test.js.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const read = path => readScreenSource(new URL(path, import.meta.url), 'utf8');
const html = read('../../../renderer/index.html'), page = read('../../../renderer/pages/linkedin-import.js'), nav = read('../../../renderer/pages/nav.js'), app = read('../../../renderer/app.js');
const preload = read('../../../preload.cjs'), handlers = read('../../../lib/linkedin-import-handlers.js'), experienceHandlers = read('../../../lib/experience-handlers.js');

test('the Profile CV card has the button, the window starts the page and ⌘K opens the dialog', () => {
  assert.match(html, /id="cv-import-linkedin"[^>]*>[^]*Import from LinkedIn/);
  assert.match(app, /import \{init as linkedinImport\} from '\.\/pages\/linkedin-import\.js'/);
  assert.match(app, /^linkedinImport\(\{onCvBuilt: cvSaved\}\);/m);
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
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-import.js', import.meta.url), 'utf8');
  assert.match(page, /const mine = \+\+runId;[^]*mine !== runId\) return;/, 'a late answer of a closed or replaced run is ignored');
  assert.match(page, /addEventListener\('close', \(\) => \{ runId\+\+; window\.pilot\.linkedinImportCancel\(\)/, 'Escape and the backdrop cancel the wait too');
  assert.match(page, /\['rate', 'version'\]\.includes\(stopped\)/, 'no Try again after rate or version');
});

// PR 3/3 (owner D3, 3 Nov 2026): the setup's CV step is the third way in; with no CV the ticked rows become the main CV through the same save as "Build one with AI".
test('the setup CV step has its LinkedIn button enabled and wired to the same dialog; the wizard gains no step', () => {
  assert.match(html, /<button class="secondary cv-way" id="cv-linkedin" type="button" title="[^"]+">/, 'enabled: no disabled attribute, no "Coming soon"');
  assert.doesNotMatch(html, /id="cv-linkedin"[^>]*disabled/);
  assert.match(page, /for \(const id of \['cv-import-linkedin', 'cv-linkedin'\]\)/);
});

test('with no main CV the ticked rows are saved as the main CV by buildCvSave, then the same follow-up as the AI build runs once', () => {
  assert.match(page, /async function buildMainCv\(answer\)/);
    assert.match(page, /makeMainCv\(answer\.cv, \{save: cv => window\.pilot\.buildCvSave\(cv\), saved: name => afterCvBuilt\(name\)\}\)/);
  assert.match(app, /linkedinImport\(\{onCvBuilt: cvSaved\}\)/, 'cv-build\'s follow-up is injected, never imported (a cycle through activity.js and nav.js)');
  assert.doesNotMatch(page, /from '\.\/cv-build\.js'/);
  assert.match(page, /No position was ticked, so no CV was made/);
  const build = read('../../../renderer/pages/cv-build.js');
  assert.equal((build.match(/await cvSaved\(result\.name\)/g) || []).length, 1, 'the AI build ends through the same function');
  assert.equal((build.match(/cvReplaced\(/g) || []).length, 1, 'cvReplaced is called in cvSaved only');
});


// The outcomes of "no main CV" played with fakes (review of PR 3/3, 3 Nov 2026): the page only draws what makeMainCv decides.
test('makeMainCv: no position makes no CV; a failed or throwing save never runs the follow-up; a throwing follow-up still says the CV is saved', async () => {
  const {makeMainCv} = await import('../../../renderer/pages/linkedin-import-cv.js');
  const cv = {name: 'Anna Rossi', jobs: [{company: 'Acme', roles: [{title: 'PM'}]}]};
  const calls = [];
  const fakes = (save, saved = async name => { calls.push(['saved', name]); }) => ({save: async given => { calls.push(['save', given.name]); return save(given); }, saved});
  assert.deepEqual(await makeMainCv({jobs: []}, fakes(() => ({ok: true}))), {kind: 'none'});
  assert.deepEqual(await makeMainCv(null, fakes(() => ({ok: true}))), {kind: 'none'});
  assert.deepEqual(calls, [], 'nothing was saved for nothing');
  assert.deepEqual(await makeMainCv(cv, fakes(() => ({ok: false, error: 'No printer'}))), {kind: 'failed', error: 'No printer'});
  assert.deepEqual(await makeMainCv(cv, fakes(() => { throw new Error('boom'); })), {kind: 'failed', error: 'boom'});
  assert.deepEqual(calls.filter(call => call[0] === 'saved'), [], 'the follow-up never ran after a failed save');
  calls.length = 0;
  assert.deepEqual(await makeMainCv(cv, fakes(() => ({ok: true, name: 'Anna_Rossi_CV.pdf'}))), {kind: 'ready', name: 'Anna_Rossi_CV.pdf'});
  assert.deepEqual(calls, [['save', 'Anna Rossi'], ['saved', 'Anna_Rossi_CV.pdf']], 'saved once, after the save');
  assert.deepEqual(await makeMainCv(cv, fakes(() => ({ok: true, name: 'X.pdf'}), async () => { throw new Error('redraw'); })), {kind: 'ready', name: 'X.pdf'}, 'the file exists: a failed redraw is not a failed CV');
});
