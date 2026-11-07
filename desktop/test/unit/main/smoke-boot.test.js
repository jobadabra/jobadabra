// Guard: release — the window probe started its script 1.5 s after the load instead of when the app had started, so a loaded runner clicked a menu whose handlers were not wired yet
// and the app (Linux) integration job went red on unchanged code twice (runs 42323054241 and 42323843622, 7 Nov 2026, "hung waiting for the Profile page"). Here the slow boot is played with a fake window.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {whenBooted} from '../../../lib/smoke-boot.js';

// A window whose app finishes starting only after `after` questions, on a fake clock: no real time passes.
function slowWindow({after, throwsFirst = 0}) {
  const clock = {t: 0}, asked = [];
  const webContents = {executeJavaScript: async code => {
    asked.push(clock.t);
    if (asked.length <= throwsFirst) throw new Error('Script failed to execute');   // the page is not there yet
    return asked.length > after;
  }};
  return {webContents, asked, clock, options: {now: () => clock.t, sleep: async ms => { clock.t += ms; }, pollMs: 25, hangMs: 60000}};
}

test('a boot slower than the old 1.5 s pause is waited for: the script starts only once the app says it has started', async () => {
  const {webContents, asked, clock, options} = slowWindow({after: 200});   // 200 polls x 25 ms = 5 s on the fake clock
  await whenBooted(webContents, options);
  assert.ok(clock.t >= 5000, `the wait lasted until the app started (${clock.t} ms), not 1500`);
  assert.equal(asked.length, 201);
});

test('a page that is not ready to answer yet is asked again, not a failure', async () => {
  const {webContents, options} = slowWindow({after: 3, throwsFirst: 2});
  await whenBooted(webContents, options);
});

test('an app that never finishes starting ends as a hang that says what it last saw, never as a script run too early', async () => {
  const {webContents, options} = slowWindow({after: Infinity});
  await assert.rejects(() => whenBooted(webContents, options), /did not finish starting \(window\.__jp is not set\); last state: false/);
});

test('the smoke run starts its script from that state in both places a clock stood in for it, and the page marks the end of its start', () => {
  const window = fs.readFileSync(new URL('../../../lib/main-window.js', import.meta.url), 'utf8');
  assert.equal(window.match(/await whenBooted\(/g).length, 2, 'after the load and after the reload');
  assert.doesNotMatch(window, /setTimeout\(async \(\) => \{/, 'no clock between the load and the script');
  assert.match(fs.readFileSync(new URL('../../../renderer/app.js', import.meta.url), 'utf8'), /^window\.__jp = /m, 'renderer/app.js sets window.__jp as the end of its start');
});
