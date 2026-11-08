// Every row of Settings → Automation → Schedules has its e-mail switch (owner, 8 Nov 2026: "We're missing the email notifications switch for each automation"): the table in index.html is read row by row,
// so a task added later without a `data-mail-slot` row, or a slot naming a mail the app cannot switch, fails here. Plan docs/superpowers/plans/2026-11-08-mw-automation-mails.md 3/5.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {ROWS} from '../../../lib/mail-choices.js';
import {rows as labels} from '../../../i18n/catalogs/mail-labels.js';

const html = readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
const table = html.slice(html.indexOf('<div class="task-table">'), html.indexOf('id="schedule-mail-note"'));
const taskRows = table.split(/<(?:div|label) class="task-row/).slice(1).filter(row => !row.startsWith(' is-head'));
const nameOf = row => /<b[^>]*>([^<]+)<\/b>/.exec(row)?.[1].replace(/&amp;/g, '&');

test('the Schedules table has the four automations the owner named, each with an e-mail cell', () => {
  assert.deepEqual(taskRows.map(nameOf), ['Find jobs', 'Check Gmail & Calendar', 'Ready to send', 'Apply for me']);
  for (const row of taskRows) assert.match(row, /class="mail-cell"/, `${nameOf(row)} has an E-mail me cell`);
});

test('every Schedules row has a switch: its cell names a mail the app can switch, with a label, and no two rows share one', () => {
  const slots = taskRows.map(row => ({name: nameOf(row), slot: /class="mail-cell" data-mail-slot="([^"]+)"/.exec(row)?.[1]}));
  for (const {name, slot} of slots) {
    assert.ok(slot, `${name} has no data-mail-slot: its row would show no switch`);
    assert.ok(ROWS.includes(slot), `${name}: ${slot} is not one of the app's switches (lib/mail-choices.js ROWS)`);
    assert.ok(Object.hasOwn(labels, slot), `${name}: ${slot} has no label in the seven languages`);
  }
  assert.deepEqual(slots.map(entry => entry.slot), ['app-matches', 'app-reminder', 'app-ready', 'app-applied']);
});

test('the new rows are in every language and the Notifications list (ROWS) matches the website\'s eight app rows', () => {
  assert.deepEqual(ROWS, ['app-matches', 'app-needs-you', 'app-applied', 'app-reminder', 'app-ready', 'app-weekly', 'app-stopped', 'app-nothing']);
  for (const id of ['app-reminder', 'app-ready']) assert.equal(labels[id].length, 7);
});
