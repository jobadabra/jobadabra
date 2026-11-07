// The finding a desktop tester leaves for the twin launcher (lib/tester-finding.js).
// Guard: privacy — the employer, job title, url and e-mail of the owner's real data never reach a public GitHub issue through a tester's sentences; nothing is written outside the twin's folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findingOf, namesOf, scrub, writeFinding} from '../../../lib/tester-finding.js';

const INPUT = {title: 'Acme Corp page shows Senior Designer twice', journey: 'J3', severity: 'high', expected: 'one row for Senior Designer at ACME  CORP', seen: 'Mail igor@example.com sees acme corp listed again, also Acme Co and Acme',
  steps: 'open Acme Corp\nPress Apply on https://jobs.acme.example/senior-designer-42'};
const JOBS = [{company: 'Acme Corp', title: 'Senior Designer', url: 'https://jobs.acme.example/senior-designer-42', recruiterName: 'Jane Roe', salary: '90k'}, {company: 'Globex, Inc.', title: 'Analyst', url: 'https://globex.example/a'}];
const NAMES = namesOf({jobs: JOBS, email: 'igor@example.com'});
const BUNDLE = {id: '0123456789abcdef', url: 'https://x.test/b'}, AT = new Date('2026-11-07T10:00:00Z');

test('employer (also without its legal ending), job title, url, recruiter and e-mail are removed from every sentence, in any case or spacing', () => {
  assert.ok(NAMES.includes('Jane Roe') && NAMES.includes('igor') && NAMES.includes('Globex') && !NAMES.includes('90k'));
  const finding = findingOf({input: INPUT, at: AT, bundle: BUNDLE, source: 'desktop-tester', names: NAMES});
  const text = JSON.stringify(finding.report).toLowerCase();
  for (const word of ['acme', 'senior designer', 'jane', 'igor', 'senior-designer-42', 'jobs.acme']) assert.ok(!text.includes(word), `${word} is gone from ${text}`);
  assert.equal(finding.report.severity, 'high');
  assert.equal(finding.report.journey, 'J3');
});

test('a plural of a name goes too, a longer word that merely starts with it stays, and a title cut from "seen" is cut after the names are gone', () => {
  assert.equal(scrub('Senior Designers like Designer work', ['Senior Designer']), '<removed> like Designer work');
  assert.equal(scrub('Designer and Designed', ['Design']), 'Designer and Designed');
  const seen = `${'x'.repeat(80)} the page of Acme Corp is broken`;
  const finding = findingOf({input: {...INPUT, title: '', seen}, at: AT, bundle: BUNDLE, source: 'desktop-tester', names: NAMES});
  assert.ok(!/acme/i.test(finding.report.title), `the default title (${finding.report.title.length} characters) has no part of the employer`);
});

test('the finding is written into the twin folder under the bundle id; an id that is not one, or an empty report, writes nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-finding-'));
  try {
    const finding = findingOf({input: INPUT, at: AT, bundle: BUNDLE, source: 'desktop-tester', names: NAMES});
    const file = writeFinding(home, finding);
    assert.equal(file, path.join(home, 'tester-findings', '0123456789abcdef.json'));
    assert.throws(() => writeFinding(home, {...finding, bundleId: '../../x'}), /usable id/);
    assert.throws(() => writeFinding(home, findingOf({input: {...INPUT, expected: ''}, at: AT, bundle: BUNDLE, source: 'desktop-tester', names: NAMES})), /empty/);
    assert.deepEqual(fs.readdirSync(path.join(home, 'tester-findings')), ['0123456789abcdef.json']);
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});
