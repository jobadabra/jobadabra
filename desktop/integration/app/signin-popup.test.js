// Layer 2 (a throwaway Electron, hidden windows, stand-in pages): the sign-in window's popup stays attached to the page that opened it. Owner, 5 Nov 2026: "When I try to enable LInkedin jobs. And I click login
// with Google, it doesn't really work" (Chrome showed a blank accounts.google.com/gsi/select page); his choice: "Allow popup, you try once". The scenario: the page's button opens a sized popup (window.open),
// the popup must find window.opener and answer it, the page then moves on and LinkedIn's cookie appears, so the window ends as a sign-in; a plain link still goes to the browser. Red before the fix: the popup
// went to the browser, had no opener, and the window never signed in. Never real LinkedIn, Google or Apple, never the owner's session (a fake cookie; every https request is answered by the probe).
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {needsElectron} from '../../test/needs-electron.js';

const desktop = fileURLToPath(new URL('../..', import.meta.url));

test('a provider\'s popup finds its opener, the sign-in comes through, and every window closes; a link goes to the browser', needsElectron, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-signin-popup-'));
  try {
    const out = path.join(folder, 'answer.json');
    const run = spawnSync(path.join(desktop, 'node_modules', '.bin', 'electron'), [fileURLToPath(new URL('./signin-popup-main.js', import.meta.url))], {
      cwd: desktop, encoding: 'utf8', timeout: 120000, env: {...process.env, JOBADABRA_POPUP_PROBE_DIR: folder, JOBADABRA_POPUP_PROBE_OUT: out}});
    assert.ok(fs.existsSync(out), `the probe wrote no answer (exit ${run.status}, signal ${run.signal}): ${(run.stderr || run.stdout || '').slice(-600)}`);
    const answer = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(answer.error, undefined, answer.error);
    assert.deepEqual(answer.afterLink, {external: ['https://help.standin.example/'], windows: 1}, 'a link opens in the browser, not as a window');
    assert.equal(answer.popup.opener, 'yes', 'the popup has window.opener');
    assert.deepEqual(answer.popup.externalAfter, ['https://help.standin.example/'], 'the popup did not go to the browser');
    assert.deepEqual(answer.result, {ok: true, cookieNames: ['li_at']}, 'the page saw the popup\'s answer and the window ended as a sign-in');
    assert.equal(answer.popupsMade, 1, 'the popup was a window of the app');
    assert.equal(answer.windowsAfter, 0, 'the popup and the window are closed');
    assert.equal(answer.cookiesAfter, 0, 'the storage is cleared');
    assert.deepEqual(answer.requests.filter(r => !/^(www\.linkedin\.com|sso\.standin\.example|help\.standin\.example)\//.test(r)), [], 'only stand-in hosts were asked');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});
