// Guard: safety — without it the practice app (which runs Full automation, Submit included) could start on a person's real data folder, ship in an installer, or hold a job on a real employer's name.
// Spec docs/superpowers/specs/2026-11-07-practice-jobs-design.md: practice is dev-only, on a throwaway temp folder, with jobs on names the IANA keeps for examples.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {everyRealDataFolder} from '../../../lib/app-identity.js';
import {caughtFor, practiceLedger} from '../../../lib/practice-mode.js';
import {FOLDER, practiceRefusal} from '../../../practice/gate.js';
import {PRACTICE_CASES, practiceJobs, reservedHost} from '../../../practice/jobs.js';

const desktop = path.resolve(import.meta.dirname, '..', '..', '..');

test('practice starts only on its own throwaway folder in the temp folder, never on a real data folder', () => {
  const tmp = os.tmpdir();
  assert.equal(practiceRefusal(path.join(tmp, FOLDER)), '');
  assert.match(practiceRefusal(''), /no folder/);
  assert.match(practiceRefusal('jobadabra-practice'), /no folder/);
  assert.match(practiceRefusal(path.join(tmp, 'other')), /must be/);
  assert.match(practiceRefusal(path.join(tmp, FOLDER, 'sub')), /must be/);
  for (const real of everyRealDataFolder().filter(folder => path.isAbsolute(folder))) {   // the other OS's folder is not a path here
    assert.match(practiceRefusal(real), /real data folder/);
    assert.match(practiceRefusal(path.join(real, 'x')), /real data folder/);
    // even a "temp folder" that is a real one (a test names it) is refused
    assert.match(practiceRefusal(path.join(real, FOLDER), {tmp: real}), /real data folder/);
  }
});

test('practice is not in the installer and nothing the installer ships imports it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
  assert.equal(pkg.build.files.some(entry => /practice/i.test(entry)), false, 'build.files lists practice');
  assert.match(pkg.scripts.practice, /practice\/launch\.mjs/);
  const shipped = [...pkg.build.files.filter(entry => entry.endsWith('/**')).map(entry => entry.slice(0, -3)), ...['start.js', 'main.js']];
  const walk = target => (fs.statSync(target).isDirectory() ? fs.readdirSync(target).flatMap(name => walk(path.join(target, name))) : /\.(c|m)?js$/.test(target) ? [target] : []);
  const files = shipped.filter(entry => entry !== 'shared' && fs.existsSync(path.join(desktop, entry))).flatMap(entry => walk(path.join(desktop, entry)));
  assert.ok(files.length > 50);
  const importers = files.filter(file => /\b(?:from|import|require)\s*\(?\s*['"][^'"]*practice\//.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(importers.map(file => path.relative(desktop, file)), []);
});

test('every practice job is a recorded form with a submit control on a name only examples use', () => {
  assert.equal(reservedHost('jobs.example.com'), true);
  assert.equal(reservedHost('careers.wall.example'), true);
  assert.equal(reservedHost('x.example.test'), true);
  for (const real of ['jobs.lever.co', 'jobs.ashbyhq.com', 'jobs.example.ch', 'example.com.evil.io', 'myexample.com']) assert.equal(reservedHost(real), false, real);
  const jobs = practiceJobs();   // throws for a missing case, a page without a form + submit control, or a host that is not reserved
  assert.equal(jobs.length, PRACTICE_CASES.length);
  assert.equal(new Set(jobs.map(job => job.name)).size, jobs.length);
  assert.equal(new Set(jobs.map(job => job.url)).size, jobs.length);
  for (const job of jobs) assert.equal(reservedHost(new URL(job.url).host), true, job.url);
});

test('the practice banner and caught-submission view exist only in the launcher-started dev app: no variable, a packaged app, or a non-e2e app is not a practice run', () => {
  const ledger = path.join(os.tmpdir(), 'x.jsonl');
  assert.equal(practiceLedger({JOBADABRA_E2E: '1', JOBADABRA_PRACTICE_LEDGER: ledger}, false), ledger);
  assert.equal(practiceLedger({JOBADABRA_E2E: '1', JOBADABRA_PRACTICE_LEDGER: ledger}, true), '', 'a packaged app ignores the variable');
  assert.equal(practiceLedger({JOBADABRA_PRACTICE_LEDGER: ledger}, false), '', 'not the e2e-mode app the launcher starts');
  assert.equal(practiceLedger({JOBADABRA_E2E: '1'}, false), '');
  assert.deepEqual(caughtFor('', 'https://jobs.example.com/a'), []);
});

test('caughtFor returns only the job\'s own submissions, newest first, and survives a half-written ledger', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-practice-ledger-read-'));
  try {
    const file = path.join(dir, 'caught.jsonl');
    const row = (host, pathname, name) => JSON.stringify({at: name, host, path: pathname, how: 'submit', fields: [['name', name]], posted: false});
    fs.writeFileSync(file, [row('jobs.example.com', '/a', 'first'), row('jobs.example.com', '/b', 'other job'), row('jobs.example.com', '/a', 'second'), '{"half'].join('\n'));
    assert.deepEqual(caughtFor(file, 'https://jobs.example.com/a').map(entry => entry.at), ['second', 'first']);
    assert.deepEqual(caughtFor(file, 'https://other.example.com/a'), []);
    assert.deepEqual(caughtFor(path.join(dir, 'missing.jsonl'), 'https://jobs.example.com/a'), []);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
