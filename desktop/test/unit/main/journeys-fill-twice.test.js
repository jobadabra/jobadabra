// Journey: Fill in Chrome pressed twice on one job with its tab open. Moved out of journeys.test.js unchanged (8 Nov 2026, Gitar on #3595: that file was at 497 of 500 lines).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as terminals from '../../../lib/terminals.js';
import * as apply from '../../../lib/apply.js';
import * as review from '../../../lib/review.js';

const FORM = 'https://apply.example/form';

test('scenario: Fill in Chrome pressed twice on one job with its tab open: one tab, the session keeps it, the open tab refills (22 Oct 2026, beta run 8)', async () => {
  terminals._reset(); review._reset();
  const opened = [], focused = [];
  const options = {open: (...args) => { opened.push(args); return {unref() {}}; }, focus: async arg => { focused.push(arg.id); return 'tab'; }, run: async () => {}, id: () => 'f1'};
  const first = await apply.applyOne({}, FORM, {company: 'A'}, options);
  assert.equal(opened.length, 1);
  review.noteTabs({ids: [5], boot: 'b1', sessions: {5: first.session.id}}, new Set([first.session.id]));   // the extension reports the tab open and carrying the session
  await apply.applyOne({}, FORM, {company: 'A'}, options);
  assert.equal(opened.length, 1, 'the second press opens no second tab');
  assert.deepEqual(focused, [first.session.id]);
  const reply = review.report([{id: first.session.id, url: FORM, kind: 'form'}], {url: FORM, session: first.session.id, tab: 5, boot: 'b1', total: 9, left: 0});
  assert.ok(reply.commands.some(command => command.reload), 'the open tab reloads, so its mark fills the form again');
  assert.equal(review.tabOf(first.session.id), 5, 'the session stays on its one tab');
});
