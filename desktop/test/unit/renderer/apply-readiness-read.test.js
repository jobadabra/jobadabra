// Which apply check a Jobs row holds after the list is read again (renderer/apply-readiness-read.js heldAfterList, used by pages/jobs-triage.js keepStored).
// Why (#3997 review): a stored check was never replaced or dropped while the window was open, so a changed posting kept its old "Needs you" line and "Account needed" chip.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {heldAfterList} from '../../../renderer/apply-readiness-read.js';

const stored = {login: true, stored: true}, madeHere = {login: false, simple: true}, newer = {accountCreation: true, stored: true};

test('a stored read follows the list: replaced by the newer check, dropped when the posting changed', () => {
  assert.equal(heldAfterList(stored, newer), newer);
  assert.equal(heldAfterList(stored, null), null, 'the posting changed: no old chip');
  assert.equal(heldAfterList(null, newer), newer, 'a restart: the stored check is taken');
  assert.equal(heldAfterList(null, null), null);
});

test('a read made in this window wins over the list', () => {
  assert.equal(heldAfterList(madeHere, newer), madeHere);
  assert.equal(heldAfterList(madeHere, null), madeHere);
});
