// ⌘K for the notification offer (every new action is in the palette; spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): the commands exist only while the card would be drawn.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addNotifyCommands, setNotifyState} from '../renderer/pages/notify-commands.js';

const base = {reached: true, by: ['app'], telegram: false, email: '', confirmed: false, serviceOff: false, unconfirmedStopped: false, sending: true};
const labelsFor = state => { setNotifyState(state); const labels = []; addNotifyCommands((group, label) => labels.push(label)); return labels; };

test('no channel: one command to set it up; an address waiting for its link: also Resend; a working channel or an unread state: none', () => {
  assert.deepEqual(labelsFor(base), ['Get a message when something needs you']);
  assert.deepEqual(labelsFor({...base, by: ['email', 'app'], email: 'me@example.com'}), ['Get a message when something needs you', 'Resend the confirmation e-mail']);
  assert.deepEqual(labelsFor({...base, by: ['email', 'app'], email: 'me@example.com', confirmed: true}), []);
  assert.deepEqual(labelsFor(null), []);
  assert.deepEqual(labelsFor({...base, reached: false}), []);
});
