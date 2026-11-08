// The ratchet against tests that read the real date (tools/unpinned-clock.mjs; owner, 31 Oct 2026: "No test reads the real date/clock unpinned; add a guard for new ones"): the reads of
// 31 Oct 2026 may only shrink; a new one in a test file fails here. Fix: pin the clock (`t.mock.timers.enable({apis: ['Date'], now})` in node, a fixed `now=` argument or a patched clock in python),
// or say `// clock: relative <why>` when the read only compares two readings of the same clock.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ALLOWED, countLines, ledgerProblems, scan} from '../../../../tools/unpinned-clock.mjs';
import fs from 'node:fs';

// Why (8 Nov 2026, fr; Gitar on #3636): the rule lives once, in ledgerProblems; `--check` (the Python-only PR's twin test) and this test both ask it, so they cannot disagree again (#3629).
test('no test file reads the real clock more often than its recorded debt, and fixed files leave the list', () => {
  const {found, stale} = ledgerProblems(scan(), fs.readFileSync(ALLOWED, 'utf8'));
  assert.deepEqual(found, [], 'a new unpinned clock read: pin the clock in that test, or say `// clock: relative <why>` on the line');
  assert.equal(stale, false, `fixed: run \`node tools/unpinned-clock.mjs --write\` so ${ALLOWED} is exactly what the scan finds: one sorted \`<count><TAB><path>\` line per file, a paid-off file leaves (the debt only shrinks)`);
});

test('what the ratchet counts: a calendar read in an unpinned file; not durations, comments, marked lines or a file that pins', () => {
  assert.equal(countLines('const day = new Date().toISOString().slice(0, 10);'), 1);
  assert.equal(countLines('const tomorrow = new Date(Date.now() + 86400000).toISOString();'), 1, 'a date built from now plus a span is a calendar value');
  assert.equal(countLines('const deadline = Date.now() + 5000;'), 0, 'a poll deadline is a span');
  assert.equal(countLines('const yesterday = new Date(Date.now() - 86400000);'), 1, 'now minus a number is a past date');
  assert.equal(countLines('os.utime(path, (time.time() - 3600, time.time() - 3600))'), 1, 'an hour before the clock, set as a file time: the review-cache and mail_google bug');
  assert.equal(countLines('const waited = Date.now() - started;'), 0, 'now minus a reading is a span');
  assert.equal(countLines('const lastSeen = Date.now();'), 1, 'a stored timestamp is a calendar value');
  assert.equal(countLines('const clock = () => Date.now();'), 1, 'an arrow function is not a comparison');
  assert.equal(countLines('const made = Date.now();\nstore(made);'), 1);
  assert.equal(countLines('const started = Date.now();\nassert.ok(Date.now() - started < 50);'), 0, 'a duration');
  assert.equal(countLines('while (Date.now() < end) poll();'), 0);
  assert.equal(countLines("now = datetime.now(timezone.utc)\nrows = [now.isoformat()]"), 1);
  assert.equal(countLines('today = date.today()'), 1);
  assert.equal(countLines('stamp = time.time()'), 1);
  assert.equal(countLines('elapsed = time.time() - start'), 0);
  assert.equal(countLines('// uses new Date() to ...\n# datetime.now() in a comment'), 0);
  assert.equal(countLines('const now = new Date();   // clock: relative the rows and the call share this one reading'), 0);
  assert.equal(countLines("test('x', t => { t.mock.timers.enable({apis: ['Date'], now: 0}); return new Date().getDate(); });"), 0, 'the file pins the clock');
});
