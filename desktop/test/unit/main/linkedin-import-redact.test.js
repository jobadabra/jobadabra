// The LinkedIn import key never leaves in "Send feedback" (spec docs/superpowers/specs/2026-11-03-linkedin-profile-import-design.md, acceptance 7): the same redactor as the logs
// (lib/feedback-bundle.js) is fed a log full of FAKE keys in every shape the import code could print them (bare, header, query, form body, JSON), plus fake profile text.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {redact} from '../../../lib/feedback-bundle.js';
import {SERVICE} from '../../../lib/linkedin-import.js';

const KEY = 'AQVfakeDMAkey1234567890abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_fake';
const LOG = [
  `GET /rest/memberSnapshotData?q=criteria&domain=POSITIONS Authorization: Bearer ${KEY}`,
  `{"access_token":"${KEY}","expires_in":5184000,"scope":"r_dma_portability_3rd_party"}`,
  `POST /linkedin-import/callback state=AbCdEf0123456789AbCdEf0123456789AbCdEf012&access_token=${KEY}&expires_in=5184000`,
  `${SERVICE} value ${KEY} stored`,
  `token: ${KEY}`,
  'imported Ada Fake, Data Analyst at Northwind, ada.fake@example.test',
].join('\n');

test('a log full of fake import keys leaves no key and no e-mail', () => {
  const out = redact(LOG, {home: '/Users/ana.fake'});
  assert.ok(!out.includes(KEY), 'no whole key');
  assert.ok(!/AQVfakeDMAkey/.test(out), 'no part of a key');
  assert.ok(!out.includes('ada.fake@example.test'), 'no e-mail');
  assert.ok(!out.includes('AbCdEf0123456789AbCdEf0123456789AbCdEf012'), 'the awaited state is a secret too');
  assert.match(out, /memberSnapshotData/, 'the readable part of a line stays');
});
