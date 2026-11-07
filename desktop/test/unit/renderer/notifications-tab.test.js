// Notifications is its own Settings tab, right after Automation (owner, 3 Nov 2026: "Notifications should be a separate tab in Settings. Not inside Automations").
// Guards: the tab's button and page in renderer/index.html, the section name a pop-up may open (renderer/targets.js), and every text that names the place.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean, plan, SECTIONS} from '../../../renderer/targets.js';

const read = file => readScreenSource(new URL(`../../../${file}`, import.meta.url), 'utf8');
const html = read('renderer/index.html');
const pageOf = name => html.split('<div class="settings-page" data-settings-page="').find(part => part.startsWith(`${name}"`)) || '';   // from its opening tag to the next page's
const CONTROLS = ['notify-email', 'notify-address', 'notify-cadence', 'notify-app', 'notify-telegram', 'notify-telegram-connect', 'notify-message'];

test('Settings lists Notifications right after Automation, with a bell', () => {
  const buttons = [...html.matchAll(/<button data-settings-go="([\w-]+)"[^>]*><i data-icon="([\w-]+)">/g)].map(([, go, icon]) => [go, icon]);
  const at = buttons.findIndex(([go]) => go === 'notifications');
  assert.ok(at > 0, 'a Notifications button in the Settings list');
  assert.equal(buttons[at - 1][0], 'automation', 'right after Automation');
  assert.equal(buttons[at][1], 'bell');
});

test('the Notifications page holds the whole card and Automation keeps none of it', () => {
  const tab = pageOf('notifications'), automation = pageOf('automation');
  assert.ok(tab, 'a Notifications settings page');
  assert.match(tab, /id="setting-notify"/);
  for (const id of CONTROLS) {
    assert.match(tab, new RegExp(`id="${id}"`), `${id} is on the Notifications page`);
    assert.doesNotMatch(automation, new RegExp(`id="${id}"`), `${id} left the Automation page`);
  }
  assert.doesNotMatch(automation, /id="setting-notify"/);
});

test('a pop-up about notifications opens the Notifications tab', () => {
  assert.ok(SECTIONS.includes('notifications'));
  assert.deepEqual(clean({view: 'settings', section: 'notifications'}), {view: 'settings', section: 'notifications'});
  assert.deepEqual(plan({view: 'settings', section: 'notifications'}), ['view:settings', 'section:notifications']);
  assert.ok(html.includes('data-settings-page="notifications"'), 'the section names a page that exists');
});

test('the "Saved ✓" pop-up of the Notifications card opens the Notifications tab, the schedules\' keeps Automation', () => {
  const connections = read('renderer/pages/connections.js'), notify = read('renderer/pages/notify-settings.js');
  assert.match(connections, /function savedToast\(title, body = '', section = 'automation'\)/);
  assert.match(connections, /\{view: 'settings', section\}, 'good'\)/);
  assert.match(notify, /savedToast\('Saved ✓', .*, 'notifications'\)/);
});

test('no text still says the card lives under Automation', () => {
  const stale = [];
  for (const file of ['lib/notify-channel.js', 'lib/notify-handlers.js', 'lib/pipeline-env.js', 'lib/setup-handlers.js', 'renderer/notify-words.js', 'renderer/pages/services-list.js', 'renderer/pages/notify-settings.js']) {
    read(file).split('\n').forEach((line, i) => { if (/Automation → Notifications/.test(line)) stale.push(`${file}:${i + 1}`); });
  }
  assert.deepEqual(stale, []);
  assert.match(html, /tells you by email or Telegram \(Settings → Notifications\)/, 'Always on\'s "How it works" names the tab, not "above"');
});

test('the card has no heading of its own: the page heading says Notifications (owner, 3 Nov 2026: "drop inner heading")', () => {
  const card = pageOf('notifications').split('id="setting-notify"')[1]?.split(/id="setting-(?:mail|cloud)"/)[0] || '';   // the Email card only: the next card on the tab (the per-mail switches, hr 4/8) has a title of its own
  assert.doesNotMatch(card, /<h3>/);
  assert.match(pageOf('notifications'), /<h2>Notifications<\/h2>/);
});

test('the "Updating <repo>…" status shows on the tab that saved: both tabs have a state line and saveState writes to both', () => {
  assert.match(pageOf('notifications'), /class="muted small save-state" id="notifications-state"/);
  assert.match(pageOf('automation'), /class="muted small save-state" id="automation-state"/);
  assert.match(read('renderer/pages/connections.js'), /const saveState = [^\n]*'automation-state'[^\n]*'notifications-state'/);
});
